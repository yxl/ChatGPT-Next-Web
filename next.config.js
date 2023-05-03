/** @type {import('next').NextConfig} */

const withYaml = require('next-plugin-yaml');
 
const nextConfig = {
  experimental: {
    appDir: true,
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
  output: "standalone",
};

module.exports = withYaml(nextConfig);
