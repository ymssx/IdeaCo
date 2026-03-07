const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = require(packageJsonPath);

console.log(`\n📦 Current version: ${packageJson.version}`);

function runCommand(command) {
  try {
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`❌ Failed to execute command: ${command}`);
    return false;
  }
}

function release() {
  // Check for uncommitted changes
  try {
    const status = execSync('git status --porcelain').toString();
    if (status) {
      console.error('❌ Git working directory is not clean. Please commit or stash changes first.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to check git status.');
    process.exit(1);
  }

  rl.question('Select release type (patch/minor/major) [patch]: ', (answer) => {
    const type = answer.trim().toLowerCase() || 'patch';
    
    if (!['patch', 'minor', 'major'].includes(type)) {
      console.error('❌ Invalid release type. Please choose patch, minor, or major.');
      rl.close();
      process.exit(1);
    }

    console.log(`\n🚀 Releasing ${type} version...`);

    // npm version handles updating package.json, creating a git commit, and tagging
    // %s will be replaced by the new version number
    const versionCommand = `npm version ${type} -m "chore(release): %s"`;
    
    if (!runCommand(versionCommand)) {
      console.error('❌ Version bump failed.');
      rl.close();
      process.exit(1);
    }

    console.log('\n📤 Pushing changes and tags to GitHub...');
    
    // Push both commits and tags
    // Using --follow-tags pushes only annotated tags that are reachable from the pushed commits, 
    // but npm version creates annotated tags by default, so git push --follow-tags is safer/better than git push && git push --tags?
    // Actually git push --follow-tags is often enough if configured, but explicit is better.
    
    if (runCommand('git push') && runCommand('git push --tags')) {
        console.log('\n✅ Release successful! Version updated and pushed.');
    } else {
        console.error('\n❌ Failed to push to remote.');
    }

    rl.close();
  });
}

release();
