// Node.js 版本检查
export function checkNodeVersion() {
  const requiredVersion = '20.0.0';
  const currentVersion = process.version;
  
  // 解析版本号
  const parseVersion = (version) => {
    const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3])
    };
  };

  const required = parseVersion(requiredVersion);
  const current = parseVersion(currentVersion);

  if (!current) {
    console.error('❌ 无法解析当前 Node.js 版本:', currentVersion);
    process.exit(1);
  }

  if (!required) {
    console.error('❌ 无法解析要求的 Node.js 版本:', requiredVersion);
    process.exit(1);
  }

  // 比较版本
  const isCompatible = 
    current.major > required.major ||
    (current.major === required.major && current.minor > required.minor) ||
    (current.major === required.major && current.minor === required.minor && current.patch >= required.patch);

  if (!isCompatible) {
    console.error('❌ Node.js 版本不兼容!');
    console.error(`   当前版本: ${currentVersion}`);
    console.error(`   要求版本: >= ${requiredVersion}`);
    console.error('\n💡 请升级 Node.js 到 20.0.0 或更高版本');
    console.error('   下载地址: https://nodejs.org/');
    process.exit(1);
  }

  console.log(`✅ Node.js 版本检查通过: ${currentVersion} (要求 >= ${requiredVersion})`);
} 