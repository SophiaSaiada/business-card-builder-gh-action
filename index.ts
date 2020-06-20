import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as io from "@actions/io";
import * as ioUtil from "@actions/io/lib/io-util";
import https from "https";

const DEFAULT_DEPLOY_BRANCH = "master";

const callOnDoneWebhook = (repo: string) => {
  const onDoneWebhookUrl = core.getInput("on-done-webhook-url");
  if (/12/) {
    console.log("Calling onDone webhook at " + onDoneWebhookUrl);

    const data = JSON.stringify({ repo });

    const onDoneWebhookUrlRegexGroups = onDoneWebhookUrl.match(
      /https:\/\/([^\/]+)(\/.*)/
    );
    if (onDoneWebhookUrlRegexGroups === null) {
      core.setFailed(`Invalid webhook url.`);
      return;
    }

    const options = {
      hostname: onDoneWebhookUrlRegexGroups[1],
      port: 443,
      path: onDoneWebhookUrlRegexGroups[2],
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        core.setFailed(`Webhook returned ${res.statusCode}.`);
      }
    });

    req.on("error", (error) => {
      core.setFailed(`Webhook error: ${error}.`);
    });

    req.write(data);
    req.end();
  } else {
    console.log("Skip calling onDone webhook.");
  }
};

async function run(): Promise<void> {
  try {
    const accessToken = core.getInput("access-token");
    if (!accessToken) {
      core.setFailed(
        "No personal access token found. Please provide one by setting the `access-token` input for this action."
      );
      return;
    }

    const deployBranch =
      core.getInput("deploy-branch") || DEFAULT_DEPLOY_BRANCH;

    if (github.context.ref === `refs/heads/${deployBranch}`) {
      console.log(`Triggered by branch used to deploy: ${github.context.ref}.`);
      console.log("Nothing to deploy.");
      return;
    }

    const PUBLIC_DIR = "./public";

    console.log("Cleaning public folder...");
    await exec.exec(`rm -rf ${PUBLIC_DIR} && mkdir public`);

    const builderScriptVersion =
      core.getInput("builder-script-version") || "latest";
    const command = `cat ./data.json | npx business-card-builder-html-gen@${builderScriptVersion} > ${PUBLIC_DIR}/index.html`;
    console.log(`Building with: ${command}`);
    await exec.exec(command);
    console.log("Finished building your site.");

    const cnameExists = await ioUtil.exists("./CNAME");
    if (cnameExists) {
      console.log("Copying CNAME over.");
      await io.cp("./CNAME", "./public/CNAME", { force: true });
      console.log("Finished copying CNAME.");
    }

    const deployRepo = core.getInput("deploy-repo");
    const repo = `${github.context.repo.owner}/${
      deployRepo || github.context.repo.repo
    }`;
    const repoURL = `https://${accessToken}@github.com/${repo}.git`;
    console.log("Ready to deploy your new shiny site!");
    console.log(`Deploying to repo: ${repo} and branch: ${deployBranch}`);
    console.log(
      "You can configure the deploy branch by setting the `deploy-branch` input for this action."
    );

    await exec.exec(`git init`, [], { cwd: "./public" });
    await exec.exec(`git config user.name`, [github.context.actor], {
      cwd: "./public",
    });
    await exec.exec(
      `git config user.email`,
      [`${github.context.actor}@users.noreply.github.com`],
      { cwd: "./public" }
    );

    await exec.exec(`git add`, ["."], { cwd: "./public" });
    await exec.exec(
      `git commit`,
      [
        "-m",
        `deployed via Business Card Builder GitHub Action 🎩 for ${github.context.sha}`,
      ],
      {
        cwd: "./public",
      }
    );

    await exec.exec(`git push`, ["-f", repoURL, `master:${deployBranch}`], {
      cwd: "./public",
    });
    console.log("Finished deploying your site.");

    callOnDoneWebhook(repo);

    console.log("Enjoy! ✨");
  } catch (err) {
    core.setFailed(err.message);
  }
}

// Don't auto-execute in the test environment
if (process.env["NODE_ENV"] !== "test") {
  run();
}

export default run;
