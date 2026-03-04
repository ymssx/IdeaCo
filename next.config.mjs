/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // Required for Docker deployment
  experimental: {
    serverComponentsExternalPackages: [
      'uuid',
      'puppeteer',
      'pdf-parse',
      'openai',
      'puppeteer-core',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 将可选依赖标记为 external，避免 webpack 尝试解析/打包它们
      const optionalDeps = ['puppeteer', 'puppeteer-core', 'pdf-parse', 'openai'];
      const existingExternals = config.externals || [];

      config.externals = [
        ...existingExternals,
        // 函数形式的 externals，拦截可选依赖
        function ({ request }, callback) {
          if (optionalDeps.some(dep => request === dep || request.startsWith(dep + '/'))) {
            return callback(null, 'commonjs ' + request);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
