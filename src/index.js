// src/index.js

import { decode } from './gif-decoder';

export default {
  /**
   * Worker 的主入口函数
   * @param {Request} request - 传入的 HTTP 请求
   * @param {object} env - 环境变量和绑定 (例如 R2, AI)
   * @param {object} ctx - 执行上下文
   * @returns {Response} - 返回给客户端的响应
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get('url');

    // --- 1. 参数校验 ---
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: '请在查询参数中提供 "url"' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // --- 2. 伪造请求头下载图片 ---
      console.log(`正在下载图片: ${imageUrl}`);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      };
      const imageResponse = await fetch(imageUrl, { headers });
      if (!imageResponse.ok) {
        throw new Error(`下载图片失败，状态码: ${imageResponse.status}`);
      }
      const originalImageBuffer = await imageResponse.arrayBuffer();

      // --- 3. 提取 GIF 第一帧 ---
      console.log('正在提取 GIF 第一帧...');
      // 注意：由于 AI 模型可能不支持 GIF，我们直接将第一帧作为新 GIF 上传
      // 或者您可以将其转换为 PNG，但这需要更复杂的 WASM 库
      const firstFrame = decode(originalImageBuffer);
      if (!firstFrame) {
          throw new Error('无法从图片中提取帧，请确保它是一个有效的 GIF。');
      }

      // --- 4. 上传到 R2 ---
      const objectKey = `frame-${Date.now()}.gif`;
      console.log(`正在上传第一帧到 R2，键名: ${objectKey}`);
      await env.R2_BUCKET.put(objectKey, firstFrame.buffer, {
        httpMetadata: { contentType: firstFrame.contentType },
      });

      // --- 5. 调用 Workers AI 进行识别 ---
      console.log('正在调用 Workers AI 进行识别...');
      // 从 R2 获取刚刚上传的图片数据
      const object = await env.R2_BUCKET.get(objectKey);
      if (object === null) {
          throw new Error('在 R2 中未找到刚上传的图片。');
      }
      const frameBufferForAI = await object.arrayBuffer();

      // 使用 @cf/microsoft/trocr-base-handwritten 模型进行OCR识别
      const inputs = {
        image: [...new Uint8Array(frameBufferForAI)],
      };
      const aiResponse = await env.AI.run('@cf/microsoft/trocr-base-handwritten', inputs);
      
      console.log('AI 识别结果:', aiResponse.text);

      // --- 6. 解析 AI 结果并计算 ---
      // 清理 AI 可能返回的无关字符，只保留数字和运算符
      const expression = aiResponse.text.replace(/[^0-9+\-*/]/g, '');
      const match = expression.match(/(\d+)([+\-*/])(\d+)/);

      if (!match) {
        throw new Error(`无法从AI结果 "${aiResponse.text}" 中解析出数学表达式`);
      }

      const num1 = parseInt(match[1], 10);
      const operator = match[2];
      const num2 = parseInt(match[3], 10);
      let result;

      switch (operator) {
        case '+': result = num1 + num2; break;
        case '-': result = num1 - num2; break;
        case '*': result = num1 * num2; break;
        case '/': result = num1 / num2; break;
        default: throw new Error(`不支持的运算符: ${operator}`);
      }

      // --- 7. 返回最终结果 ---
      return new Response(JSON.stringify({
        detectedExpression: expression,
        calculationResult: result,
        r2ObjectKey: objectKey,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Worker 执行出错:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
