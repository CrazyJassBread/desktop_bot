---
kind: external_dependency
name: DeepSeek AI对话服务
slug: deepseek
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### DeepSeek AI对话服务
- 角色：提供大语言模型对话能力，用于处理用户问题和生成可打印的回答内容
- 集成点：apps/web/services/deepseek-client.mjs中通过HTTP API调用，使用DEEPSEEK_API_KEY认证
- 使用模式：当前使用deepseek-v4-flash文本模型，OCR/视觉描述需要另外接入视觉模型
- 配置：.env.local中设置DEEPSEEK_BASE_URL和DEEPSEEK_MODEL，默认https://api.deepseek.com
- 限制：纯文本模型，不能直接处理图像或生成视觉描述