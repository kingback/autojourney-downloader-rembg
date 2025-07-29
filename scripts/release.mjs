import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { Octokit } from 'octokit';

const filesSrc = 'src/files';
const outputDist = 'dist';

// 读取package.json获取版本号
function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

// 计算文件的SHA512校验和
function calculateSHA512(filePath) {
  const hash = crypto.createHash('sha512');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('base64');
}

// 获取文件大小（字节）
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

// 压缩文件夹为zip文件
function zipFolder(sourcePath, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // 最大压缩级别
    });

    output.on('close', () => {
      console.log(`✅ 压缩完成: ${path.basename(sourcePath)} -> ${path.basename(outputPath)}`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize();
  });
}

// 生成info.json文件
function generateInfoJson(version, files) {
  const info = {
    version: version,
    files: files,
    releaseDate: new Date().toISOString()
  };
  return JSON.stringify(info, null, 2);
}

// 获取GitHub仓库信息
function getGitHubInfo() {
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error('无法解析GitHub仓库URL');
  }
  return {
    owner: match[1],
    repo: match[2].replace('.git', '')
  };
}

// 创建GitHub draft release
async function createGitHubRelease(version, files, outputDir) {
  const githubToken = process.env.GH_TOKEN;
  if (!githubToken) {
    console.log('⚠️  GH_TOKEN 环境变量未设置，跳过GitHub release创建');
    return;
  }

  try {
    const { owner, repo } = getGitHubInfo();
    console.log(`🔗 GitHub仓库: ${owner}/${repo}`);

    const octokit = new Octokit({
      auth: githubToken
    });

    // 检查release是否已存在
    let release;
    try {
      const response = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag: `v${version}`
      });
      release = response.data;
      console.log(`📋 找到已存在的release: ${release.html_url}`);
    } catch (error) {
      if (error.status === 404) {
        // 创建新的draft release
        const response = await octokit.rest.repos.createRelease({
          owner,
          repo,
          tag_name: `v${version}`,
          name: `${version}`,
          body: `Release version ${version}`,
          draft: true,
          prerelease: false
        });
        release = response.data;
        console.log(`✅ 创建新的draft release: ${release.html_url}`);
      } else {
        throw error;
      }
    }

    // 上传文件到release
    console.log(`📤 开始上传文件到GitHub release...`);
    for (const file of files) {
      const filePath = path.join(outputDir, file.url);
      if (fs.existsSync(filePath)) {
        console.log(`📤 上传: ${file.url}`);

        const fileBuffer = fs.readFileSync(filePath);
        await octokit.rest.repos.uploadReleaseAsset({
          owner,
          repo,
          release_id: release.id,
          name: file.url,
          data: fileBuffer
        });

        console.log(`✅ 上传完成: ${file.url}`);
      }
    }

    // 上传info.json
    const infoPath = path.join(outputDir, 'info.json');
    if (fs.existsSync(infoPath)) {
      console.log(`📤 上传: info.json`);
      const infoBuffer = fs.readFileSync(infoPath);
      await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name: 'info.json',
        data: infoBuffer
      });
      console.log(`✅ 上传完成: info.json`);
    }

    console.log(`🎉 GitHub release创建完成: ${release.html_url}`);

  } catch (error) {
    console.error('❌ GitHub release创建失败:', error.message);
    if (error.status === 401) {
      console.error('💡 请检查GH_TOKEN是否正确设置');
    }
  }
}

// 主函数
async function main() {
  try {
    const version = getVersion();
    console.log(`🚀 开始发布版本: ${version}`);

    // 创建输出目录
    const outputDir = path.join(outputDist, version);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取files目录下的所有文件夹
    const filesDir = filesSrc;
    const items = fs.readdirSync(filesDir, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory());

    if (folders.length === 0) {
      console.log('❌ files目录下没有找到文件夹');
      process.exit(1);
    }

    console.log(`📁 找到 ${folders.length} 个文件夹:`);
    folders.forEach(folder => console.log(`  - ${folder.name}`));

    const files = [];

    // 压缩每个文件夹
    for (const folder of folders) {
      const sourcePath = path.join(filesDir, folder.name);
      const zipFileName = `${folder.name}.zip`;
      const outputPath = path.join(outputDir, zipFileName);

      console.log(`\n📦 正在压缩: ${folder.name}`);
      await zipFolder(sourcePath, outputPath);

      // 计算文件信息
      const sha512 = calculateSHA512(outputPath);
      const size = getFileSize(outputPath);

      files.push({
        url: zipFileName,
        sha512: sha512,
        size: size
      });

      console.log(`📊 文件信息:`);
      console.log(`  大小: ${(size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  SHA512: ${sha512}`);
    }

    // 生成info.json文件
    const infoJson = generateInfoJson(version, files);
    const infoPath = path.join(outputDir, 'info.json');
    fs.writeFileSync(infoPath, infoJson);

    console.log(`\n✅ 发布完成!`);
    console.log(`📁 输出目录: ${outputDir}`);
    console.log(`📄 生成文件:`);
    files.forEach(file => {
      console.log(
        `  - ${file.url} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
      );
    });
    console.log(`  - info.json`);

    // 创建GitHub release
    await createGitHubRelease(version, files, outputDir);

  } catch (error) {
    console.error('❌ 发布失败:', error.message);
    process.exit(1);
  }
}

main(); 