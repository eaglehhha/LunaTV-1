/**
 * HLS.js Loader with Ad Filtering
 *
 * 功能：
 * 1. 广告过滤：过滤带 #AD 标记的分段
 * 2. 直连模式支持：支持 allowCORS 参数
 * 3. 源站标识：支持 moontv-source 参数
 * 4. 自定义去广告代码支持
 *
 * 注意：基于 hls.js 的顺序加载设计（推荐做法），不实现并发预取
 * 参考：https://github.com/video-dev/hls.js/blob/master/docs/design.md
 */

import Hls from 'hls.js';

interface OptimizedHlsLoaderConfig {
  filterAds?: boolean; // 是否过滤广告
  enableDirectConnect?: boolean; // 是否启用直连模式
  sourceKey?: string; // 源站标识（用于 moontv-source 参数）
  customAdFilterCode?: string; // 自定义去广告代码
  currentSource?: string; // 当前播放源（用于自定义去广告代码）
}

class OptimizedHlsLoader extends Hls.DefaultConfig.loader {
  private filterAds: boolean;
  private enableDirectConnect: boolean;
  private sourceKey: string;
  private customAdFilterCode: string;
  private currentSource: string;

  constructor(config: any) {
    super(config);
    const loaderConfig = config as OptimizedHlsLoaderConfig;
    this.filterAds = loaderConfig.filterAds ?? false;
    this.enableDirectConnect = loaderConfig.enableDirectConnect ?? false;
    this.sourceKey = loaderConfig.sourceKey ?? '';
    this.customAdFilterCode = loaderConfig.customAdFilterCode ?? '';
    this.currentSource = loaderConfig.currentSource ?? '';

    const originalLoad = this.load.bind(this);
    this.load = (context: any, config: any, callbacks: any) => {
      // 🔹 添加 moontv-source 参数（用于直播源标识）
      if (this.sourceKey) {
        try {
          const url = new URL(context.url, window.location.origin);
          url.searchParams.set('moontv-source', this.sourceKey);
          context.url = url.toString();
        } catch {
          // ignore URL parse error
        }
      }

      // 🔹 拦截 manifest 和 level 请求（广告过滤 + 直连模式）
      if (context.type === 'manifest' || context.type === 'level') {
        // 直连模式：添加 allowCORS 参数
        if (this.enableDirectConnect) {
          try {
            const url = new URL(context.url, window.location.origin);
            url.searchParams.set('allowCORS', 'true');
            context.url = url.toString();
          } catch {
            // 如果 URL 解析失败，回退到字符串拼接
            context.url = context.url + (context.url.includes('?') ? '&' : '?') + 'allowCORS=true';
          }
        }

        // 广告过滤：拦截 onSuccess 回调
        if (this.filterAds) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = (response: any, stats: any, context: any) => {
            if (response.data && typeof response.data === 'string') {
              response.data = this.filterAdsFromM3U8(response.data);
            }
            onSuccess(response, stats, context);
          };
        }
      }

      originalLoad(context, config, callbacks);
    };
  }

  /**
   * 过滤 m3u8 内容中的广告分段（#AD 标记 + URL 关键字检测 + 自定义去广告代码）
   */
  private filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 如果有自定义去广告代码，优先使用
    if (this.customAdFilterCode && this.customAdFilterCode.trim()) {
      try {
        // 移除 TypeScript 类型注解,转换为纯 JavaScript
        const jsCode = this.customAdFilterCode
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 创建并执行自定义函数
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        const result = customFunction(this.currentSource, m3u8Content);
        // eslint-disable-next-line no-console
        console.log('✅ 使用自定义去广告代码');
        return result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('执行自定义去广告代码失败,降级使用默认规则:', err);
        // 继续使用默认规则
      }
    }

    // 默认去广告规则
    // 广告关键字列表
    const adKeywords = [
      'sponsor',
      '/ad/',
      '/ads/',
      'advert',
      'advertisement',
      '/adjump',
      'redtraffic'
    ];

    const lines = m3u8Content.split('\n');
    const filteredLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 跳过 #EXT-X-DISCONTINUITY 标识
      if (line.includes('#EXT-X-DISCONTINUITY')) {
        i++;
        continue;
      }

      // 检测到 #AD 标记
      if (line.includes('#AD')) {
        i++;
        continue;
      }

      // 如果是 EXTINF 行，检查下一行 URL 是否包含广告关键字
      if (line.includes('#EXTINF:')) {
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const containsAdKeyword = adKeywords.some(keyword =>
            nextLine.toLowerCase().includes(keyword.toLowerCase())
          );

          if (containsAdKeyword) {
            // 跳过 EXTINF 行和 URL 行
            i += 2;
            continue;
          }
        }
      }

      filteredLines.push(line);
      i++;
    }

    return filteredLines.join('\n');
  }
}

export default OptimizedHlsLoader;
