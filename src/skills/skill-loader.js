/**
 * Skill Loader - 載入並管理 Agent Skills
 */
const fs = require('fs');
const path = require('path');

class SkillLoader {
    constructor(skillsPath) {
        this.skillsPath = skillsPath;
        this.skills = new Map();
        this.loadedSkills = new Map();
    }

    scan() {
        if (!fs.existsSync(this.skillsPath)) {
            console.log(`[SkillLoader] Skills path not found: ${this.skillsPath}`);
            return [];
        }
        const dirs = fs.readdirSync(this.skillsPath, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
        
        for (const dir of dirs) {
            const mdPath = path.join(this.skillsPath, dir, 'SKILL.md');
            if (fs.existsSync(mdPath)) {
                try {
                    const meta = this.parseMetadata(mdPath);
                    if (meta) {
                        this.skills.set(meta.name, { ...meta, dir, path: mdPath });
                        console.log(`[SkillLoader] Loaded: ${meta.name}`);
                    }
                } catch (err) {
                    console.error(`[SkillLoader] Error loading ${dir}:`, err.message);
                }
            }
        }
        return this.getSkillList();
    }

    parseMetadata(filePath) {
        let content = fs.readFileSync(filePath, 'utf-8');
        content = content.replace(/\r\n/g, '\n');
        
        const m = content.match(/^---\n([\s\S]*?)\n---/);
        if (!m) return null;
        
        const fm = m[1];
        const name = fm.match(/^name:\s*(.+)$/m);
        const desc = fm.match(/^description:\s*(.+)$/m);
        const trig = fm.match(/^triggers:\s*\[(.+)\]$/m);
        
        if (!name) return null;
        return {
            name: name[1].trim(),
            description: desc ? desc[1].trim() : '',
            triggers: trig ? trig[1].split(',').map(t => t.trim()) : []
        };
    }

    getSkillList() {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name, description: s.description, triggers: s.triggers
        }));
    }

    getSkillSummary() {
        if (this.skills.size === 0) return '';
        let summary = '\n## Available Skills\n';
        for (const [_, skill] of this.skills) {
            summary += `- **${skill.name}**: ${skill.description}`;
            if (skill.triggers.length > 0) summary += ` (triggers: ${skill.triggers.join(', ')})`;
            summary += '\n';
        }
        return summary;
    }

    loadSkill(name) {
        if (this.loadedSkills.has(name)) return this.loadedSkills.get(name);
        const skill = this.skills.get(name);
        if (!skill) return null;
        
        let content = fs.readFileSync(skill.path, 'utf-8');
        content = content.replace(/\r\n/g, '\n');
        
        const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        const body = bodyMatch ? bodyMatch[1].trim() : content;
        
        const fullSkill = { ...skill, content: body, files: this.listSkillFiles(skill.dir) };
        this.loadedSkills.set(name, fullSkill);
        return fullSkill;
    }

    listSkillFiles(dir) {
        const skillDir = path.join(this.skillsPath, dir);
        return fs.readdirSync(skillDir).filter(f => f !== 'SKILL.md' && !f.startsWith('.'));
    }

    matchSkills(message) {
        const matched = [];
        const lower = message.toLowerCase();
        for (const [name, skill] of this.skills) {
            for (const trigger of skill.triggers) {
                if (lower.includes(trigger.toLowerCase())) {
                    matched.push(name);
                    break;
                }
            }
        }
        return matched;
    }
}

module.exports = SkillLoader;