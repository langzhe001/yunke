// src/gif-decoder.js

/**
 * 一个简化的 GIF 解析器，用于提取第一帧图像数据。
 * 注意：这是一个基础实现，可能无法处理所有类型的 GIF 文件。
 * * @param {ArrayBuffer} arrayBuffer - GIF 文件的二进制数据
 * @returns {Object|null} 包含第一帧图像数据的对象，或在失败时返回 null
 */
export function decode(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  const gif = {};

  // 读取 GIF 头部信息
  gif.header = {
    signature: String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, 0, 3)),
    version: String.fromCharCode.apply(null, new Uint8Array(arrayBuffer, 3, 3)),
  };

  if (gif.header.signature !== 'GIF') {
    throw new Error('Invalid GIF signature');
  }

  // 读取逻辑屏幕描述符
  gif.width = dataView.getUint16(6, true);
  gif.height = dataView.getUint16(8, true);
  const packed = dataView.getUint8(10);
  gif.globalColorTableFlag = (packed & 0x80) !== 0;
  gif.colorResolution = (packed & 0x70) >> 4;
  gif.sortFlag = (packed & 0x08) !== 0;
  gif.globalColorTableSize = 1 << ((packed & 0x07) + 1);
  gif.backgroundColorIndex = dataView.getUint8(11);
  gif.pixelAspectRatio = dataView.getUint8(12);

  let pos = 13;

  // 读取全局颜色表 (如果存在)
  if (gif.globalColorTableFlag) {
    gif.globalColorTable = new Uint8Array(arrayBuffer, pos, gif.globalColorTableSize * 3);
    pos += gif.globalColorTableSize * 3;
  }

  // 寻找第一个图像描述符
  while (pos < arrayBuffer.byteLength) {
    const blockType = dataView.getUint8(pos);
    pos++;

    if (blockType === 0x2C) { // 图像描述符开始
      const image = {};
      image.left = dataView.getUint16(pos, true);
      image.top = dataView.getUint16(pos + 2, true);
      image.width = dataView.getUint16(pos + 4, true);
      image.height = dataView.getUint16(pos + 6, true);
      const packedImage = dataView.getUint8(pos + 8);
      image.localColorTableFlag = (packedImage & 0x80) !== 0;
      pos += 9;

      // 如果有局部颜色表，使用它；否则使用全局颜色表
      const colorTable = image.localColorTableFlag ? 
        new Uint8Array(arrayBuffer, pos, (1 << ((packedImage & 0x07) + 1)) * 3) : 
        gif.globalColorTable;
        
      if (image.localColorTableFlag) {
        pos += (1 << ((packedImage & 0x07) + 1)) * 3;
      }
      
      const lzwMinCodeSize = dataView.getUint8(pos);
      pos++;

      // 从这里开始是图像数据块，我们只关心提取，不进行完整的 LZW 解码
      // 对于大多数简单的 GIF，第一个数据块就足够了
      let dataSize = dataView.getUint8(pos);
      pos++;
      
      // 创建一个简单的单帧 GIF 文件 (这是个技巧)
      // 我们构建一个新的、只包含第一帧的 GIF 文件 buffer
      // 头部 + 逻辑屏幕描述符 + 全局颜色表 + 第一个图像描述符 + 图像数据 + 结尾
      
      // 找到图像数据的结束位置
      let endOfImageData = pos + dataSize;
      while(dataView.getUint8(endOfImageData) !== 0x00) {
        endOfImageData += dataView.getUint8(endOfImageData) + 1;
      }
      endOfImageData++; // 包含最后的 0x00 块
      
      const firstFrameData = arrayBuffer.slice(pos, endOfImageData);
      
      // 构建新的 ArrayBuffer
      const headerAndScreen = arrayBuffer.slice(0, 13 + (gif.globalColorTableFlag ? gif.globalColorTableSize * 3 : 0));
      const imageDescriptor = arrayBuffer.slice(pos - 10 - (image.localColorTableFlag ? (1 << ((packedImage & 0x07) + 1)) * 3 : 0), pos);
      
      const trailer = new Uint8Array([0x3B]); // GIF 结尾标识
      
      const newGifBuffer = new ArrayBuffer(headerAndScreen.byteLength + imageDescriptor.byteLength + firstFrameData.byteLength + trailer.byteLength);
      const newGifView = new Uint8Array(newGifBuffer);
      
      newGifView.set(new Uint8Array(headerAndScreen), 0);
      newGifView.set(new Uint8Array(imageDescriptor), headerAndScreen.byteLength);
      newGifView.set(new Uint8Array(firstFrameData), headerAndScreen.byteLength + imageDescriptor.byteLength);
      newGifView.set(trailer, headerAndScreen.byteLength + imageDescriptor.byteLength + firstFrameData.byteLength);
      
      return {
        buffer: newGifBuffer,
        contentType: 'image/gif'
      };
    }
    // 跳过其他块 (例如扩展块)
    else if (blockType === 0x21) {
        const extensionLabel = dataView.getUint8(pos);
        pos++;
        let subBlockSize = dataView.getUint8(pos);
        pos++;
        while (subBlockSize !== 0) {
            pos += subBlockSize;
            subBlockSize = dataView.getUint8(pos);
            pos++;
        }
    } else {
        // 未知块或文件结尾
        break;
    }
  }

  return null;
}
