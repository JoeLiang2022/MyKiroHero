#!/usr/bin/env node
/**
 * MyKiroHero MCP Server
 * 讓 Kiro 直接呼叫 WhatsApp Gateway
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const SkillLoader = require('./skills/skill-loader.js');

// 初始化 Skill Loader
const skillsPath = path.join(__dirname, '../skills');
const skillLoader = new SkillLoader(skillsPath);
skillLoader.scan();

// 動態取得 Gateway URL
function getGatewayUrl() {
    // 優先使用環境變數
    if (process.env.GATEWAY_URL) {
        return process.env.GATEWAY_URL;
    }
    
    // 嘗試從 port 檔案讀取
    const portFile = path.join(__dirname, 'gateway/.gateway-port');
    const altPortFile = path.join(__dirname, '../.gateway-port');
    
    for (const file of [portFile, altPortFile]) {
        try {
            if (fs.existsSync(file)) {
                const port = fs.readFileSync(file, 'utf-8').trim();
                if (port && !isNaN(port)) {
                    return `http://localhost:${port}`;
                }
            }
        } catch (err) {
            // ignore
        }
    }
    
    // 預設
    return 'http://localhost:3000';
}

// 建立 MCP Server
const server = new Server(
    {
        name: 'mykiro-gateway',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 定義可用的 tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'send_whatsapp',
                description: '發送 WhatsApp 訊息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chatId: {
                            type: 'string',
                            description: 'WhatsApp chat ID (例如: 886912345678@c.us)',
                        },
                        message: {
                            type: 'string',
                            description: '要發送的訊息內容',
                        },
                    },
                    required: ['chatId', 'message'],
                },
            },
            {
                name: 'send_whatsapp_media',
                description: '發送 WhatsApp 媒體檔案（圖片、影片等）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        chatId: {
                            type: 'string',
                            description: 'WhatsApp chat ID',
                        },
                        filePath: {
                            type: 'string',
                            description: '檔案路徑',
                        },
                        caption: {
                            type: 'string',
                            description: '檔案說明文字（選填）',
                        },
                    },
                    required: ['chatId', 'filePath'],
                },
            },
            {
                name: 'get_gateway_status',
                description: '取得 Gateway 狀態',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'list_skills',
                description: '列出所有可用的 Agent Skills',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'load_skill',
                description: '載入指定的 Skill 完整內容',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Skill 名稱',
                        },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'get_weather',
                description: '查詢指定地點的天氣（使用 wttr.in API）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: '地點名稱（例如: Taipei, 三重, Tokyo）',
                        },
                    },
                    required: ['location'],
                },
            },
        ],
    };
});

// 處理 tool 呼叫
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const GATEWAY_URL = getGatewayUrl();

    try {
        switch (name) {
            case 'send_whatsapp': {
                const response = await fetch(`${GATEWAY_URL}/api/reply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        platform: 'whatsapp',
                        chatId: args.chatId,
                        message: args.message,
                    }),
                });
                const result = await response.json();
                return {
                    content: [{ type: 'text', text: JSON.stringify(result) }],
                };
            }

            case 'send_whatsapp_media': {
                const response = await fetch(`${GATEWAY_URL}/api/reply/media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        platform: 'whatsapp',
                        chatId: args.chatId,
                        filePath: args.filePath,
                        caption: args.caption || '',
                    }),
                });
                const result = await response.json();
                return {
                    content: [{ type: 'text', text: JSON.stringify(result) }],
                };
            }

            case 'get_gateway_status': {
                const response = await fetch(`${GATEWAY_URL}/api/health`);
                const result = await response.json();
                return {
                    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                };
            }

            case 'list_skills': {
                const skills = skillLoader.getSkillList();
                const summary = skillLoader.getSkillSummary();
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Found ${skills.length} skills:\n${summary}` 
                    }],
                };
            }

            case 'load_skill': {
                const skill = skillLoader.loadSkill(args.name);
                if (!skill) {
                    return {
                        content: [{ type: 'text', text: `Skill not found: ${args.name}` }],
                        isError: true,
                    };
                }
                return {
                    content: [{ 
                        type: 'text', 
                        text: `# ${skill.name}\n\n${skill.content}\n\n---\nAdditional files: ${skill.files.join(', ') || 'none'}` 
                    }],
                };
            }

            case 'get_weather': {
                const location = encodeURIComponent(args.location);
                const response = await fetch(`https://wttr.in/${location}?format=j1`);
                
                if (!response.ok) {
                    throw new Error(`wttr.in API error: ${response.status}`);
                }
                
                const data = await response.json();
                const current = data.current_condition[0];
                const area = data.nearest_area[0];
                
                // 格式化天氣資訊
                const weather = {
                    location: area.areaName[0].value,
                    country: area.country[0].value,
                    temperature: `${current.temp_C}°C`,
                    feelsLike: `${current.FeelsLikeC}°C`,
                    condition: current.weatherDesc[0].value,
                    humidity: `${current.humidity}%`,
                    windSpeed: `${current.windspeedKmph} km/h`,
                    windDir: current.winddir16Point,
                    visibility: `${current.visibility} km`,
                    uvIndex: current.uvIndex,
                    observationTime: current.observation_time,
                };
                
                const text = `📍 ${weather.location}, ${weather.country}
🌡️ 溫度: ${weather.temperature} (體感 ${weather.feelsLike})
☁️ 天氣: ${weather.condition}
💧 濕度: ${weather.humidity}
💨 風速: ${weather.windSpeed} ${weather.windDir}
👁️ 能見度: ${weather.visibility}
☀️ UV 指數: ${weather.uvIndex}`;
                
                return {
                    content: [{ type: 'text', text }],
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});

// 啟動 server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] MyKiro Gateway MCP Server running');
}

main().catch(console.error);
