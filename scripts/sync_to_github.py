#!/usr/bin/env python3
"""把本地文件整树直传 GitHub（免 git push：走 api.github.com，git 通道被墙时可用）。

用法：
  # 推送 git 索引里的所有文件（默认 --git-index）
  python3 scripts/sync_to_github.py --owner JadeGovernor --repo task-sync-app -m "同步文件"

  # 推送指定文件（非 git 目录，比如数据种子）
  python3 scripts/sync_to_github.py --owner JadeGovernor --repo task-sync --cwd /tmp/seed -m "初始化" \
      --files tasks.json checkins.json settings.json

认证：环境变量 GH_TOKEN/GITHUB_TOKEN，缺省时自动调用 `gh auth token`。
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


def api(token, method, url, payload=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "task-sync-deploy")
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            msg = json.loads(body).get("message", "") or ""
        except Exception:
            msg = body[:300].decode("utf-8", "replace")
        sys.exit("API %s %s 失败(%s): %s" % (method, url, e.code, msg))


def get_token():
    for env in ("GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(env):
            return os.environ[env]
    return subprocess.check_output(["gh", "auth", "token"], text=True).strip()


def collect_files(args):
    """返回 {相对路径: git 文件模式}。显式文件列表时按可执行位判断。"""
    if args.files:
        modes = {}
        for f in args.files:
            full = os.path.join(args.cwd, f)
            modes[f] = "100755" if os.access(full, os.X_OK) else "100644"
        return modes
    out = subprocess.check_output(
        ["git", "-C", args.cwd, "ls-files", "-s", "-z"], text=False
    )
    modes = {}
    for chunk in out.split(b"\x00"):
        if not chunk:
            continue
        head, _, path = chunk.partition(b"\t")
        mode = head.split(b" ")[0].decode("ascii")
        modes[path.decode("utf-8")] = mode
    return modes


def main():
    p = argparse.ArgumentParser(description="直传文件树到 GitHub 仓库")
    p.add_argument("--owner", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("-m", "--message", default="同步文件")
    p.add_argument("--cwd", default=".")
    p.add_argument("--files", nargs="*", help="指定文件列表（相对 cwd）；缺省用 git 索引")
    args = p.parse_args()

    token = get_token()
    base = "https://api.github.com/repos/%s/%s" % (args.owner, args.repo)
    file_modes = collect_files(args)
    files = [f for f in file_modes if not os.path.isdir(os.path.join(args.cwd, f))]
    if not files:
        sys.exit("没有可上传的文件")

    _, repo = api(token, "GET", base)
    branch = repo["default_branch"]
    print("仓库 %s/%s 默认分支：%s，文件 %d 个" % (args.owner, args.repo, branch, len(files)))

    # 1) 每个文件建 blob
    shas = {}
    for f in files:
        with open(os.path.join(args.cwd, f), "rb") as fh:
            content = fh.read()
        b64 = base64.b64encode(content).decode("ascii")
        _, blob = api(token, "POST", base + "/git/blobs",
                      {"content": b64, "encoding": "base64"})
        shas[f] = blob["sha"]
        print("  blob %s (%d B)" % (f, len(content)))

    # 2) 建整树
    tree = [{"path": f, "mode": file_modes[f], "type": "blob", "sha": shas[f]} for f in files]
    _, tr = api(token, "POST", base + "/git/trees", {"tree": tree})
    tree_sha = tr["sha"]

    # 3) 找父提交并建 commit
    parents = []
    _, ref = api(token, "GET", base + "/git/ref/heads/" + branch)
    if ref and ref.get("object"):
        parents = [ref["object"]["sha"]]
    _, cm = api(token, "POST", base + "/git/commits",
                {"message": args.message, "tree": tree_sha, "parents": parents})
    commit_sha = cm["sha"]
    print("提交 %s" % commit_sha)

    # 4) 更新分支引用（不存在则创建）
    st, _ = api(token, "PATCH", base + "/git/refs/heads/" + branch,
                {"sha": commit_sha, "force": True})
    if st not in (200, 201):
        api(token, "POST", base + "/git/refs",
            {"ref": "refs/heads/" + branch, "sha": commit_sha})
    print("已更新分支 %s -> %s" % (branch, commit_sha))
    print(commit_sha)


if __name__ == "__main__":
    main()
