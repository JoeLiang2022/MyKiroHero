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

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

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
        ],
    };
});

// 處理 tool 呼叫
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
