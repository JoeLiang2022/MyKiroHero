/**
 * Skill Loader - 載入並管理 Custom Skills（知識型 skills）
 * 
 * 只管 src/skills/ 裡的 custom skills（研究筆記/架構文件）。
 * .kiro/skills/ 的 Agent Skills 由 Kiro 原生 discloseContext 管理，不在此處理。
 * 
 * - Progressive Disclosure: Level 1 (metadata) → Level 2 (full content) → Level 3 (resources)
 * - 支援 name, description, version, allowed-tools, triggers 欄位
 * - 使用 SearchEngine 進行語意匹配（BM25 + RRF）
 * - 精準 trigger 匹配 + 自動建議機制
 */
const fs = require('fs');
const path = require('path');
const SearchEngine = require('./search-engine.js');

class SkillLoader {
    constructor(skillsPath, options = {}) {
        this.skillsPath = skillsPath;
        this.skills = new Map();           // Level 1: metadata only
        this.loadedSkills = new Map();     // Level 2: full content cached
        this.searchEngine = new SearchEngine();  // 統一搜尋引擎
        this.triggerIndex = new Map();     // trigger → skill name 快速查找
        this.triggerTokens = new Map();    // 預先 tokenize 的 triggers
    }

    /**
     * 掃描 src/skills/ 目錄，載入所有 custom skill 的 metadata (Level 1)
     */
    scan() {
        // 🔧 清空舊資料，避免垃圾累積
        this.skills.clear();
        this.loadedSkills.clear();
        this.triggerIndex.clear();
        this.triggerTokens.clear();
        
        const skillDocs = [];  // 用於初始化 SearchEngine
        let customCount = 0;
        
        // 掃描 src/skills/（custom skills only）
        if (fs.existsSync(this.skillsPath)) {
            const dirs = fs.readdirSync(this.skillsPath, { withFileTypes: true })
                .filter(d => d.isDirectory() && !d.name.startsWith('_'))
                .map(d => d.name);
            
            for (const dir of dirs) {
                const skillPath = path.join(this.skillsPath, dir);
                const loaded = this._loadSkillFromPath(skillPath, dir, 'custom', skillDocs);
                if (loaded) customCount++;
            }
        }
        
        // 初始化 SearchEngine（用於語意搜尋）
        if (skillDocs.length > 0) {
            this.searchEngine.init(skillDocs);
            console.log(`[SkillLoader] SearchEngine initialized with ${skillDocs.length} skills`);
        }
        
        console.log(`[SkillLoader] Total: ${customCount} custom skills`);
        
        return this.getSkillList();
    }

    /**
     * 從指定路徑載入單一 skill
     * @private
     * @param {string} fullPath - skill 資料夾的完整路徑
     * @param {string} dirName - 資料夾名稱（用於顯示）
     * @param {string} source - 來源類型：'kiro' 或 'custom'
     * @param {Array} skillDocs - SearchEngine 文檔陣列
     */
    _loadSkillFromPath(fullPath, dirName, source, skillDocs) {
        const mdPath = path.join(fullPath, 'SKILL.md');
        
        if (!fs.existsSync(mdPath)) return false;
        
        try {
            const meta = this.parseMetadata(mdPath);
            if (!meta) return false;
            
            // 如果已經有同名 skill，跳過
            if (this.skills.has(meta.name)) {
                console.log(`[SkillLoader] ⚠️ Skipping duplicate: ${meta.name} (already loaded)`);
                return false;
            }
            
            this.skills.set(meta.name, { 
                ...meta, 
                dir: dirName,
                fullPath,
                path: mdPath,
                source
            });
            
            // 準備 SearchEngine 文檔
            skillDocs.push({
                id: meta.name,
                title: meta.displayName,
                tags: meta.triggers,
                summary: meta.description
            });
            
            // 建立 trigger 快速索引
            this.buildTriggerIndex(meta.name, meta.triggers);
            
            const marker = '🔧';
            console.log(`[SkillLoader] ${marker} Loaded: ${meta.name} v${meta.version || '?'} (${meta.triggers.length} triggers)`);
            return true;
        } catch (err) {
            console.error(`[SkillLoader] Error loading ${dirName}:`, err.message);
            return false;
        }
    }

    /**
     * 解析 SKILL.md 的 YAML frontmatter
     * 支援標準欄位: name, description, version, allowed-tools
     * 支援來源欄位: source, source-url
     */
    parseMetadata(filePath) {
        let content = fs.readFileSync(filePath, 'utf-8');
        content = content.replace(/\r\n/g, '\n');
        
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;
        
        const fm = match[1];
        
        // 解析各欄位
        const name = this.parseYamlField(fm, 'name');
        if (!name) return null;
        
        // description 可能是多行（用 > 開頭）
        // 多行 description 的後續行會以空格縮排
        let description = '';
        const descMatch = fm.match(/^description:\s*>?\s*\n((?:[ \t]+[^\n]*\n?)*)/im);
        if (descMatch) {
            description = descMatch[1].trim().replace(/\n\s*/g, ' ');
        } else {
            // 單行 description
            description = this.parseYamlField(fm, 'description') || '';
        }
        
        const version = this.parseYamlField(fm, 'version') || '1.0.0';
        
        // allowed-tools 是陣列
        let allowedTools = [];
        const toolsMatch = fm.match(/^allowed-tools:\s*\[([^\]]*)\]/m);
        if (toolsMatch) {
            allowedTools = toolsMatch[1]
                .split(',')
                .map(t => t.trim().replace(/['"]/g, ''))
                .filter(t => t.length > 0);
        }
        
        // 從 description 提取 triggers（如果有 "Triggers:" 標記）
        let triggers = [];
        const trigMatch = description.match(/Triggers?:\s*([^.]+)/i);
        if (trigMatch) {
            triggers = trigMatch[1]
                .split(/[,，]/)
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);
        }
        
        // 也支援 frontmatter 的 triggers: 欄位（優先）
        const triggersField = this.parseYamlField(fm, 'triggers');
        if (triggersField) {
            triggers = triggersField
                .split(/[,，]/)
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0);
        }
        
        // 來源資訊
        const source = this.parseYamlField(fm, 'source') || 'custom';
        const sourceUrl = this.parseYamlField(fm, 'source-url') || '';
        
        return {
            name: name.toLowerCase().replace(/\s+/g, '-'),
            displayName: name,
            description: description.replace(/Triggers?:\s*[^.]+\.?\s*/i, '').trim(),
            version,
            allowedTools,
            triggers,
            source,
            sourceUrl
        };
    }

    /**
     * 解析單行 YAML 欄位
     */
    parseYamlField(yaml, field) {
        const regex = new RegExp(`^${field}:\\s*(.+)`, 'm');
        const match = yaml.match(regex);
        return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null;
    }

    /**
     * 建立 trigger 快速索引
     * 每個 trigger 詞對應到 skill name，支援快速查找
     */
    buildTriggerIndex(skillName, triggers) {
        for (const trigger of triggers) {
            const lower = trigger.toLowerCase();
            if (!this.triggerIndex.has(lower)) {
                this.triggerIndex.set(lower, []);
            }
            this.triggerIndex.get(lower).push(skillName);
            
            // 預先 tokenize（用於模糊匹配）
            const tokens = this.tokenizeTrigger(lower);
            for (const token of tokens) {
                if (!this.triggerTokens.has(token)) {
                    this.triggerTokens.set(token, []);
                }
                this.triggerTokens.get(token).push(skillName);
            }
        }
    }

    /**
     * 簡單 tokenize（用於 trigger 匹配）
     */
    tokenizeTrigger(text) {
        const tokens = new Set();
        // 英文詞
        const english = text.match(/[a-z]+/g) || [];
        english.forEach(t => { if (t.length > 1) tokens.add(t); });
        // 中文字（2-gram）
        const chinese = text.match(/[\u4e00-\u9fff]+/g) || [];
        for (const c of chinese) {
            if (c.length >= 2) {
                tokens.add(c);
                for (let i = 0; i < c.length - 1; i++) {
                    tokens.add(c.substring(i, i + 2));
                }
            }
        }
        return Array.from(tokens);
    }

    /**
     * Trigger 匹配（完全匹配 O(1) + 包含匹配 O(T)）
     * 返回匹配的 skill 列表
     * 
     * 注意：包含匹配部分是 O(T)，T = trigger 總數
     * 如果 skills 數量很大，考慮只用完全匹配
     */
    exactTriggerMatch(query) {
        const lower = query.toLowerCase();
        const matched = new Set();
        
        // 完全匹配
        if (this.triggerIndex.has(lower)) {
            this.triggerIndex.get(lower).forEach(s => matched.add(s));
        }
        
        // 檢查 query 是否包含任何 trigger
        for (const [trigger, skills] of this.triggerIndex) {
            if (lower.includes(trigger) || trigger.includes(lower)) {
                skills.forEach(s => matched.add(s));
            }
        }
        
        return Array.from(matched);
    }

    /**
     * Token 級別匹配（用於模糊場景）
     * 返回 { skillName: matchCount } 的 Map
     */
    tokenTriggerMatch(query) {
        const queryTokens = this.tokenizeTrigger(query.toLowerCase());
        const scores = new Map();
        
        for (const token of queryTokens) {
            const skills = this.triggerTokens.get(token) || [];
            for (const skill of skills) {
                scores.set(skill, (scores.get(skill) || 0) + 1);
            }
        }
        
        return scores;
    }

    /**
     * 取得所有 skill 的 metadata 列表 (Level 1)
     */
    getSkillList() {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            displayName: s.displayName,
            description: s.description,
            version: s.version,
            allowedTools: s.allowedTools,
            triggers: s.triggers,
            source: s.source || 'custom',
            sourceUrl: s.sourceUrl || ''
        }));
    }

    /**
     * 產生 skill 摘要（用於 system prompt 注入）
     * 這是 Progressive Disclosure Level 1 的輸出
     */
    getSkillSummary() {
        if (this.skills.size === 0) return '';
        
        let summary = '\n## Available Skills\n';
        
        const customSkills = Array.from(this.skills.values());
        
        if (customSkills.length > 0) {
            summary += '\n### Custom Skills 🔧\n';
            for (const skill of customSkills) {
                summary += `- **${skill.name}** (v${skill.version}): ${skill.description}`;
                if (skill.allowedTools.length > 0) {
                    summary += ` [tools: ${skill.allowedTools.join(', ')}]`;
                }
                summary += '\n';
            }
        }
        
        return summary;
    }

    /**
     * 載入完整 skill 內容 (Level 2)
     */
    loadSkill(name) {
        const normalizedName = name.toLowerCase().replace(/\s+/g, '-');
        
        if (this.loadedSkills.has(normalizedName)) {
            return this.loadedSkills.get(normalizedName);
        }
        
        const skill = this.skills.get(normalizedName);
        if (!skill) return null;
        
        let content = fs.readFileSync(skill.path, 'utf-8');
        content = content.replace(/\r\n/g, '\n');
        
        // 提取 frontmatter 之後的內容
        const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1].trim() : content;
        
        const fullSkill = {
            ...skill,
            content: body,
            files: this.listSkillFiles(skill.fullPath),
            references: this.listReferences(skill.fullPath)
        };
        
        this.loadedSkills.set(normalizedName, fullSkill);
        return fullSkill;
    }

    /**
     * 列出 skill 目錄下的檔案（排除 SKILL.md）
     */
    listSkillFiles(fullPath) {
        if (!fs.existsSync(fullPath)) return [];
        return fs.readdirSync(fullPath)
            .filter(f => f !== 'SKILL.md' && !f.startsWith('.'));
    }

    /**
     * 列出 references/ 目錄下的檔案 (Level 3 準備)
     */
    listReferences(fullPath) {
        const refDir = path.join(fullPath, 'references');
        if (!fs.existsSync(refDir)) return [];
        return fs.readdirSync(refDir).filter(f => !f.startsWith('.'));
    }

    /**
     * 載入 reference 檔案 (Level 3)
     */
    loadReference(skillName, refFile) {
        const skill = this.skills.get(skillName.toLowerCase());
        if (!skill) return null;
        
        const refPath = path.join(skill.fullPath, 'references', refFile);
        
        // 🔒 Path Traversal 防護
        const resolvedPath = path.resolve(refPath);
        const resolvedBase = path.resolve(path.join(skill.fullPath, 'references'));
        if (!resolvedPath.startsWith(resolvedBase)) {
            console.error(`[SkillLoader] ⚠️ Path traversal blocked in loadReference: ${refFile}`);
            return null;
        }
        
        if (!fs.existsSync(refPath)) return null;
        
        return fs.readFileSync(refPath, 'utf-8');
    }

    /**
     * 語意搜尋 skills（精準匹配 + BM25 + RRF）
     * 這是精準匹配的核心方法
     * 
     * 搜尋策略（按優先順序）：
     * 1. 精準 trigger 匹配（最高優先）
     * 2. Token 級別匹配（次優先）
     * 3. SearchEngine 語意搜尋（fallback）
     */
    searchSkills(query) {
        const results = [];
        const seen = new Set();
        
        // 策略 1: 精準 trigger 匹配
        const exactMatches = this.exactTriggerMatch(query);
        for (const name of exactMatches) {
            const skill = this.skills.get(name);
            if (skill && !seen.has(name)) {
                results.push({
                    name,
                    displayName: skill.displayName,
                    description: skill.description,
                    version: skill.version,
                    allowedTools: skill.allowedTools,
                    source: skill.source || 'custom',
                    score: 1.0,  // 精準匹配最高分
                    matchType: 'exact'
                });
                seen.add(name);
            }
        }
        
        // 策略 2: Token 級別匹配
        const tokenScores = this.tokenTriggerMatch(query);
        const sortedTokenMatches = Array.from(tokenScores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        for (const [name, matchCount] of sortedTokenMatches) {
            if (!seen.has(name)) {
                const skill = this.skills.get(name);
                if (skill) {
                    results.push({
                        name,
                        displayName: skill.displayName,
                        description: skill.description,
                        version: skill.version,
                        allowedTools: skill.allowedTools,
                        source: skill.source || 'custom',
                        score: 0.5 + matchCount * 0.1,  // 基礎分 + 匹配數加成
                        matchType: 'token'
                    });
                    seen.add(name);
                }
            }
        }
        
        // 策略 3: SearchEngine 語意搜尋（如果前兩策略結果不足）
        if (results.length < 3 && this.searchEngine.initialized) {
            const { results: semanticResults } = this.searchEngine.search(query, { limit: 5 });
            for (const r of semanticResults) {
                if (!seen.has(r.id)) {
                    const skill = this.skills.get(r.id);
                    results.push({
                        name: r.id,
                        displayName: skill?.displayName || r.title,
                        description: skill?.description || r.summary,
                        version: skill?.version || '1.0.0',
                        allowedTools: skill?.allowedTools || [],
                        source: skill?.source || 'custom',
                        score: r.score * 0.3,  // 語意搜尋分數打折
                        matchType: 'semantic'
                    });
                    seen.add(r.id);
                }
            }
        }
        
        // 按分數排序
        return results.sort((a, b) => b.score - a.score).slice(0, 5);
    }

    /**
     * Fallback 搜尋（當 SearchEngine 未初始化時）
     */
    fallbackSearch(query) {
        const lower = query.toLowerCase();
        const results = [];
        
        for (const [, skill] of this.skills) {
            let score = 0;
            
            // 名稱匹配
            if (skill.name.includes(lower)) score += 20;
            
            // Trigger 匹配
            for (const trigger of skill.triggers) {
                if (lower.includes(trigger) || trigger.includes(lower)) {
                    score += 10;
                    break;
                }
            }
            
            // Description 包含
            if (skill.description.toLowerCase().includes(lower)) score += 5;
            
            if (score > 0) {
                results.push({
                    name: skill.name,
                    displayName: skill.displayName,
                    description: skill.description,
                    version: skill.version,
                    allowedTools: skill.allowedTools,
                    source: skill.source || 'custom',
                    score,
                    matchType: 'fallback'
                });
            }
        }
        
        return results.sort((a, b) => b.score - a.score);
    }

    /**
     * 根據訊息內容匹配相關 skills（用於自動建議）
     * 使用三層匹配策略，返回最相關的 skill 名稱列表
     * 
     * @param {string} message - 使用者訊息
     * @param {Object} options - 選項
     * @param {number} options.threshold - 最低分數門檻（預設 0.3）
     * @param {number} options.limit - 最多返回幾個（預設 3）
     * @returns {string[]} 匹配的 skill 名稱列表
     */
    matchSkills(message, options = {}) {
        const { threshold = 0.3, limit = 3 } = options;
        const results = this.searchSkills(message);
        
        return results
            .filter(r => r.score >= threshold)
            .slice(0, limit)
            .map(r => r.name);
    }

    /**
     * 取得最佳匹配的單一 skill（用於自動執行）
     * 只有當信心度夠高時才返回
     * 
     * @param {string} message - 使用者訊息
     * @param {number} minScore - 最低信心度（預設 0.7）
     * @returns {Object|null} skill 資訊或 null
     */
    getBestMatch(message, minScore = 0.7) {
        const results = this.searchSkills(message);
        if (results.length === 0) return null;
        
        const best = results[0];
        if (best.score < minScore) return null;
        
        // 如果第一名和第二名分數太接近，表示不夠確定
        if (results.length > 1 && best.score - results[1].score < 0.2) {
            return null;
        }
        
        return best;
    }

    /**
     * 取得 skill 統計資訊
     */
    getStats() {
        return {
            skillCount: this.skills.size,
            triggerCount: this.triggerIndex.size,
            tokenCount: this.triggerTokens.size,
            loadedCount: this.loadedSkills.size,
            searchEngineReady: this.searchEngine.initialized
        };
    }
}


module.exports = SkillLoader;
