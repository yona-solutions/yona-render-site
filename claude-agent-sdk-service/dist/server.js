import "dotenv/config";
import cors from "cors";
import express from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
const envSchema = z.object({
    PORT: z.coerce.number().default(3001),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AGENT_NAME: z.string().default("Claude Agent"),
    AGENT_SYSTEM_PROMPT: z.string().default("You are a helpful AI assistant.")
});
const env = envSchema.parse(process.env);
const chatRequestSchema = z.object({
    message: z.string().min(1),
    systemPrompt: z.string().optional(),
    workingDirectory: z.string().optional()
});
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "claude-agent-sdk-service",
        agentName: env.AGENT_NAME,
        anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY)
    });
});
app.post("/chat", async (req, res) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.flatten()
        });
    }
    const { message, systemPrompt, workingDirectory } = parsed.data;
    if (!env.ANTHROPIC_API_KEY) {
        return res.status(500).json({
            error: "ANTHROPIC_API_KEY is not configured"
        });
    }
    try {
        let finalText = "";
        for await (const sdkMessage of query({
            prompt: message,
            options: {
                cwd: workingDirectory ?? process.cwd(),
                env: {
                    ...process.env,
                    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY
                },
                systemPrompt: systemPrompt ?? env.AGENT_SYSTEM_PROMPT
            }
        })) {
            if (sdkMessage.type === "assistant") {
                for (const block of sdkMessage.message.content) {
                    if (block.type === "text") {
                        finalText += block.text;
                    }
                }
            }
        }
        return res.json({
            reply: finalText.trim(),
            agent: env.AGENT_NAME
        });
    }
    catch (error) {
        const messageText = error instanceof Error ? error.message : "Unknown error";
        return res.status(500).json({
            error: "Claude agent request failed",
            details: messageText
        });
    }
});
app.listen(env.PORT, () => {
    console.log(`Claude Agent SDK service listening on http://localhost:${env.PORT}`);
});
