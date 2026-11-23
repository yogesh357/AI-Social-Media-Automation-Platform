// Cloudflare Api Key
import { Response } from "express";
import { AuthRequest } from "../middlewares/authMiddlewware.js";
import { cloudinary } from "../config/cloudinary.js";
import { Generation } from "../models/Generation.js";
import { Post } from "../models/Post.js";
import OpenAI from "openai";

// =============================================================
// GENERATE POST
// POST /api/posts/generate
// =============================================================

export const generatePost = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const {
            prompt,
            tone,
            generateImage = true,
        } = req.body;

        // =====================================================
        // CHECK OPENROUTER API KEY
        // =====================================================

        if (!process.env.OPENROUTER_API_KEY) {
            res.status(400).json({
                message:
                    "OpenRouter API Key is missing. Please add OPENROUTER_API_KEY to your server/.env file.",
            });
            return;
        }

        // =====================================================
        // INITIALIZE OPENROUTER CLIENT
        // =====================================================

        const client = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: {
                "HTTP-Referer": "http://localhost:5173",
                "X-Title":
                    "AI Social Media Automation Platform",
            },
        });

        // =====================================================
        // 1. GENERATE SOCIAL MEDIA CONTENT
        // =====================================================

        console.log(
            "Generating social media content..."
        );

        const textResponse =
            await client.chat.completions.create({
                model: "openrouter/free",
                temperature: 0.8,
                messages: [
                    {
                        role: "user",
                        content: `
Generate a social media post.

Prompt:
${prompt}

Tone:
${tone}

Include relevant hashtags.

Return ONLY valid JSON.

{
    "content": "",
    "imagePrompt": ""
}

The "content" field should contain the final social media post.

The "imagePrompt" field should contain a detailed,
visually rich image-generation prompt that matches
the social media post.

Do not include markdown.
Do not include code fences.
Return only JSON.
`,
                    },
                ],
            });

        // =====================================================
        // 2. PARSE OPENROUTER RESPONSE
        // =====================================================

        let content = "";
        let imagePrompt = prompt;

        const rawText =
            textResponse.choices[0]
                ?.message?.content || "";

        console.log(
            "OpenRouter response received."
        );

        try {
            const jsonMatch =
                rawText.match(/\{[\s\S]*\}/);

            const data = jsonMatch
                ? JSON.parse(jsonMatch[0])
                : {
                    content: rawText,
                    imagePrompt: prompt,
                };

            content =
                data.content || rawText;

            imagePrompt =
                data.imagePrompt || prompt;
        } catch (error) {
            console.error(
                "Failed to parse OpenRouter JSON:",
                error
            );

            content = rawText;
            imagePrompt = prompt;
        }

        console.log(
            "Generated content successfully."
        );

        console.log(
            "Image prompt:",
            imagePrompt
        );

        // =====================================================
        // 3. IMAGE VARIABLES
        // =====================================================

        let mediaUrl:
            | string
            | undefined;

        let mediaType:
            | "image"
            | undefined;

        // =====================================================
        // 4. GENERATE IMAGE USING CLOUDFLARE WORKERS AI
        // =====================================================

        if (generateImage) {
            try {
                if (
                    !process.env.CLOUDFLARE_ACCOUNT_ID
                ) {
                    throw new Error(
                        "Cloudflare Account ID is missing. Please add CLOUDFLARE_ACCOUNT_ID to your .env file."
                    );
                }

                if (
                    !process.env.CLOUDFLARE_API_TOKEN
                ) {
                    throw new Error(
                        "Cloudflare API Token is missing. Please add CLOUDFLARE_API_TOKEN to your .env file."
                    );
                }

                console.log(
                    "Starting Cloudflare image generation..."
                );

                console.log(
                    "Image prompt:",
                    imagePrompt
                );

                const accountId =
                    process.env
                        .CLOUDFLARE_ACCOUNT_ID;

                const model =
                    "@cf/black-forest-labs/flux-1-schnell";

                // IMPORTANT:
                // Do NOT use encodeURIComponent(model).
                // Cloudflare expects the model path
                // with its "/" characters preserved.

                const cloudflareUrl =
                    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

                console.log(
                    "Cloudflare URL:",
                    cloudflareUrl
                );

                const imageResponse =
                    await fetch(
                        cloudflareUrl,
                        {
                            method: "POST",

                            headers: {
                                Authorization:
                                    `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,

                                "Content-Type":
                                    "application/json",
                            },

                            body: JSON.stringify({
                                prompt:
                                    imagePrompt,
                            }),
                        }
                    );

                // =================================================
                // CHECK CLOUDFLARE RESPONSE
                // =================================================

                if (
                    !imageResponse.ok
                ) {
                    const errorText =
                        await imageResponse.text();

                    throw new Error(
                        `Cloudflare image generation failed: ${imageResponse.status} ${errorText}`
                    );
                }

                // =================================================
                // CLOUDFLARE FLUX RESPONSE
                // =================================================

                const imageData =
                    await imageResponse.json();

                console.log(
                    "Cloudflare response received."
                );

                /*
                 * FLUX returns:
                 *
                 * {
                 *   "result": {
                 *      "image": "BASE64_IMAGE_DATA"
                 *   }
                 * }
                 */

                if (
                    !imageData?.result?.image
                ) {
                    throw new Error(
                        "Cloudflare did not return an image."
                    );
                }

                // =================================================
                // CONVERT BASE64 TO BUFFER
                // =================================================

                const imageBuffer =
                    Buffer.from(
                        imageData.result.image,
                        "base64"
                    );

                if (
                    imageBuffer.length === 0
                ) {
                    throw new Error(
                        "Cloudflare returned an empty image."
                    );
                }

                console.log(
                    "Cloudflare image generated successfully."
                );

                console.log(
                    "Image size:",
                    imageBuffer.length,
                    "bytes"
                );

                // =================================================
                // 5. UPLOAD IMAGE TO CLOUDINARY
                // =================================================

                console.log(
                    "Uploading generated image to Cloudinary..."
                );

                const uploadResult =
                    await new Promise<any>(
                        (
                            resolve,
                            reject
                        ) => {
                            const stream =
                                cloudinary
                                    .uploader
                                    .upload_stream(
                                        {
                                            folder:
                                                "ai-generations",

                                            resource_type:
                                                "image",
                                        },
                                        (
                                            error,
                                            result
                                        ) => {
                                            if (
                                                error
                                            ) {
                                                reject(
                                                    error
                                                );
                                            } else {
                                                resolve(
                                                    result
                                                );
                                            }
                                        }
                                    );

                            stream.end(
                                imageBuffer
                            );
                        }
                    );

                mediaUrl =
                    uploadResult.secure_url;

                mediaType = "image";

                console.log(
                    "Image uploaded to Cloudinary successfully."
                );

                console.log(
                    "Cloudinary URL:",
                    mediaUrl
                );
            } catch (
            imageError: any
            ) {
                // Image failure should NOT
                // stop text generation.

                console.error(
                    "Image generation failed:",
                    imageError?.message ||
                    imageError
                );

                mediaUrl =
                    undefined;

                mediaType =
                    undefined;
            }
        }

        // =====================================================
        // 6. SAVE GENERATION TO MONGODB
        // =====================================================

        console.log(
            "Saving generation to MongoDB..."
        );

        const generation =
            await Generation.create({
                user: req.user._id,
                prompt,
                content,
                mediaUrl,
                mediaType,
                tone,
            });

        // =====================================================
        // 7. RETURN RESPONSE
        // =====================================================

        res.status(200).json({
            ...generation.toObject(),

            imagePrompt,

            mediaUrl:
                mediaUrl || null,

            mediaType:
                mediaType || null,
        });

        console.log(
            "Generation completed successfully."
        );
    } catch (error: any) {
        console.error(
            "Generate post error:",
            error
        );

        res.status(500).json({
            message:
                error?.message ||
                "Server error",
        });
    }
};

// =============================================================
// GET GENERATIONS
// GET /api/posts/generations
// =============================================================

export const getGenerations = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const generations =
            await Generation.find({
                user: req.user._id,
            }).sort({
                createdAt: -1,
            });

        res.json(generations);
    } catch (error: any) {
        console.error(
            "Get generations error:",
            error
        );

        res.status(500).json({
            message:
                error?.message ||
                "Server error",
        });
    }
};

// =============================================================
// GET POSTS
// GET /api/posts
// =============================================================

export const getPosts = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const posts =
            await Post.find({
                user: req.user._id,
            });

        res.json(posts);
    } catch (error: any) {
        console.error(
            "Get posts error:",
            error
        );

        res.status(500).json({
            message:
                error?.message ||
                "Server error",
        });
    }
};

// =============================================================
// SCHEDULE POST
// POST /api/posts
// =============================================================

export const schedulePost = async (
    req: AuthRequest,
    res: Response
): Promise<void> => {
    try {
        const {
            content,
            platforms,
            scheduledFor,
            status,
        } = req.body;

        // =====================================================
        // PARSE PLATFORMS
        // =====================================================

        let parsedPlatforms =
            platforms;

        if (
            typeof platforms ===
            "string"
        ) {
            try {
                parsedPlatforms =
                    JSON.parse(
                        platforms
                    );
            } catch (error) {
                parsedPlatforms =
                    platforms.split(
                        ","
                    );
            }
        }

        // =====================================================
        // MEDIA VARIABLES
        // =====================================================

        let mediaUrl:
            | string
            | undefined =
            req.body.mediaUrl;

        let mediaType:
            | "image"
            | "video"
            | undefined =
            req.body.mediaType;

        // =====================================================
        // UPLOAD MANUAL MEDIA
        // =====================================================

        if (req.file) {
            console.log(
                "Uploading manually selected media..."
            );

            const result =
                await new Promise<any>(
                    (
                        resolve,
                        reject
                    ) => {
                        const stream =
                            cloudinary
                                .uploader
                                .upload_stream(
                                    {
                                        resource_type:
                                            "auto",

                                        folder:
                                            "social-scheduler",
                                    },
                                    (
                                        error,
                                        result
                                    ) => {
                                        if (
                                            error
                                        ) {
                                            reject(
                                                error
                                            );
                                        } else {
                                            resolve(
                                                result
                                            );
                                        }
                                    }
                                );

                        stream.end(
                            req.file!.buffer
                        );
                    }
                );

            mediaUrl =
                result.secure_url;

            mediaType =
                result.resource_type ===
                    "video"
                    ? "video"
                    : "image";

            console.log(
                "Manual media uploaded successfully."
            );
        }

        // =====================================================
        // CREATE SCHEDULED POST
        // =====================================================

        const post =
            await Post.create({
                user: req.user._id,
                content,
                platforms:
                    parsedPlatforms,
                mediaUrl,
                mediaType,
                scheduledFor,
                status,
            });

        res.status(201).json(
            post
        );
    } catch (error: any) {
        console.error(
            "Schedule post error:",
            error
        );

        res.status(500).json({
            message:
                error?.message ||
                "Server error",
        });
    }
};