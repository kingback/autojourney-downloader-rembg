import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Octokit } from 'octokit';

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

    // 准备上传文件列表
    const uploadFiles = [];
    for (const file of files) {
      const filePath = path.join(outputDir, file.url);
      if (fs.existsSync(filePath)) {
        uploadFiles.push({
          name: file.url,
          path: filePath,
          size: file.size
        });
      }
    }

    // 添加info.json到上传列表
    const infoPath = path.join(outputDir, 'info.json');
    if (fs.existsSync(infoPath)) {
      const stats = fs.statSync(infoPath);
      uploadFiles.push({
        name: 'info.json',
        path: infoPath,
        size: stats.size
      });
    }

    const totalFiles = uploadFiles.length;
    let uploadedFiles = 0;
    let totalSize = uploadFiles.reduce((sum, file) => sum + file.size, 0);
    let uploadedSize = 0;

    console.log(`📤 开始上传 ${totalFiles} 个文件到GitHub release...`);
    console.log(`📊 总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

    // 上传进度条函数
    function updateProgress(currentFile, currentSize) {
      uploadedFiles++;
      uploadedSize += currentSize;
      const progress = (uploadedFiles / totalFiles * 100).toFixed(1);
      const sizeProgress = (uploadedSize / totalSize * 100).toFixed(1);
      
      // 创建进度条
      const barLength = 30;
      const filledLength = Math.round((uploadedFiles / totalFiles) * barLength);
      const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
      
      process.stdout.write(`\r📤 上传进度: [${bar}] ${progress}% (${uploadedFiles}/${totalFiles}) - ${sizeProgress}% 大小`);
    }

    // 上传所有文件
    for (const file of uploadFiles) {
      try {
        const fileBuffer = fs.readFileSync(file.path);
        await octokit.rest.repos.uploadReleaseAsset({
          owner,
          repo,
          release_id: release.id,
          name: file.name,
          data: fileBuffer
        });

        updateProgress(file.name, file.size);
      } catch (error) {
        console.error(`\n❌ 上传失败: ${file.name} - ${error.message}`);
        uploadedFiles++;
        updateProgress(file.name, file.size);
      }
    }

    console.log(`\n✅ 上传完成! ${uploadedFiles}/${totalFiles} 个文件`);

    console.log(`🎉 GitHub release创建完成: ${release.html_url}`);

  } catch (error) {
    console.error('❌ GitHub release创建失败:', error.message);
    if (error.status === 401) {
      console.error('💡 请检查GH_TOKEN是否正确设置');
    }
  }
}

// 读取package.json获取版本号
function getVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

// 读取dist目录中的构建结果
function readBuildResult() {
  const version = getVersion();
  const outputDir = path.join('dist', version);
  
  if (!fs.existsSync(outputDir)) {
    throw new Error(`构建目录不存在: ${outputDir}，请先运行 npm run build`);
  }

  // 读取info.json文件
  const infoPath = path.join(outputDir, 'info.json');
  if (!fs.existsSync(infoPath)) {
    throw new Error(`info.json文件不存在: ${infoPath}`);
  }

  const infoJson = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  
  return {
    version: infoJson.version,
    files: infoJson.files,
    outputDir: outputDir
  };
}

// 主发布函数
async function release() {
  try {
    console.log('📖 读取构建结果...');
    const buildResult = readBuildResult();
    
    console.log(`📁 构建目录: ${buildResult.outputDir}`);
    console.log(`📄 文件列表:`);
    buildResult.files.forEach(file => {
      console.log(`  - ${file.url} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    });
    
    console.log('\n🚀 开始发布到GitHub...');
    await createGitHubRelease(buildResult.version, buildResult.files, buildResult.outputDir);
    
    console.log('\n✅ 发布流程完成!');
  } catch (error) {
    console.error('❌ 发布失败:', error.message);
    process.exit(1);
  }
}

release();