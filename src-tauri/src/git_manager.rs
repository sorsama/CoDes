use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use uuid::Uuid;

static GIT_OPERATION_LOCK: Mutex<()> = Mutex::new(());
const MAX_DIFF_BYTES: usize = 1_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    path: String,
    old_path: Option<String>,
    index_status: String,
    worktree_status: String,
    staged: bool,
    partially_staged: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    name: String,
    current: bool,
    remote: bool,
    upstream: Option<String>,
    ahead: i64,
    behind: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStash {
    index: usize,
    reference: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTag {
    name: String,
    target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    name: String,
    fetch_url: String,
    push_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    subject: String,
    author: String,
    timestamp: i64,
    parents: Vec<String>,
    decorations: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequest {
    number: u64,
    title: String,
    url: String,
    state: String,
    checks: String,
    draft: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryState {
    is_repository: bool,
    root: Option<String>,
    head: Option<String>,
    detached: bool,
    ahead: i64,
    behind: i64,
    merge_in_progress: bool,
    rebase_in_progress: bool,
    cherry_pick_in_progress: bool,
    revert_in_progress: bool,
    files: Vec<GitChangedFile>,
    branches: Vec<GitBranch>,
    stashes: Vec<GitStash>,
    tags: Vec<GitTag>,
    remotes: Vec<GitRemote>,
    commits: Vec<GitCommit>,
    pull_requests: Vec<GitPullRequest>,
    github_authenticated: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    path: Option<String>,
    staged: bool,
    binary: bool,
    truncated: bool,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    output: String,
    state: GitRepositoryState,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[serde(deny_unknown_fields)]
pub enum GitOperation {
    Init,
    Stage {
        paths: Vec<String>,
    },
    Unstage {
        paths: Vec<String>,
    },
    StagePatch {
        patch: String,
    },
    UnstagePatch {
        patch: String,
    },
    Commit {
        message: String,
        amend: Option<bool>,
    },
    CreateBranch {
        name: String,
        start_point: Option<String>,
    },
    SwitchBranch {
        name: String,
    },
    RenameBranch {
        name: String,
    },
    DeleteBranch {
        name: String,
    },
    Fetch {
        remote: Option<String>,
    },
    Pull {
        remote: Option<String>,
        branch: Option<String>,
        rebase: Option<bool>,
    },
    Push {
        remote: String,
        branch: String,
        set_upstream: Option<bool>,
    },
    Stash {
        message: Option<String>,
        include_untracked: Option<bool>,
    },
    StashApply {
        index: usize,
        pop: Option<bool>,
    },
    CreateTag {
        name: String,
        target: Option<String>,
        message: Option<String>,
    },
    DeleteTag {
        name: String,
    },
    Merge {
        branch: String,
    },
    Rebase {
        branch: String,
    },
    CherryPick {
        revision: String,
    },
    Revert {
        revision: String,
    },
    Continue {
        operation: String,
    },
    Abort {
        operation: String,
    },
    AddRemote {
        name: String,
        url: String,
    },
    RemoveRemote {
        name: String,
    },
    CreatePr {
        title: String,
        body: String,
        base: Option<String>,
        draft: Option<bool>,
    },
    CheckoutPr {
        number: u64,
    },
    MarkPrReady {
        number: u64,
    },
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let directory = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Repository path is unavailable: {error}"))?;
    if !directory.is_dir() {
        return Err("Repository path must be a directory.".into());
    }
    Ok(directory)
}

fn repository_root(path: &str) -> Result<PathBuf, String> {
    let directory = canonical_directory(path)?;
    let root = run_text(&directory, "git", &["rev-parse", "--show-toplevel"])?;
    PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Git returned an invalid repository root: {error}"))
}

fn run_output(cwd: &Path, program: &str, args: &[&str]) -> Result<Output, String> {
    Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("Could not start {program}: {error}"))
}

fn output_text(output: Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn run_text(cwd: &Path, program: &str, args: &[&str]) -> Result<String, String> {
    output_text(run_output(cwd, program, args)?)
}

fn run_with_input(cwd: &Path, program: &str, args: &[&str], input: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;
    if input.len() > MAX_DIFF_BYTES {
        return Err("Patch exceeds the 1 MB safety limit.".into());
    }
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Patch input is unavailable.".to_string())?
        .write_all(input.as_bytes())
        .map_err(|error| error.to_string())?;
    output_text(
        child
            .wait_with_output()
            .map_err(|error| error.to_string())?,
    )
}

fn safe_name(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('-')
        || value.contains('\0')
        || value.contains('\n')
        || value.contains('\r')
    {
        return Err(format!("{label} is invalid."));
    }
    Ok(value.to_string())
}

fn safe_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("Select at least one file.".into());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Repository path is unavailable: {error}"))?;
    paths
        .iter()
        .map(|path| {
            let relative = PathBuf::from(path);
            if relative.is_absolute()
                || relative.components().any(|part| {
                    matches!(
                        part,
                        Component::ParentDir | Component::RootDir | Component::Prefix(_)
                    )
                })
            {
                return Err(format!("File path escapes the repository: {path}"));
            }
            let joined = canonical_root.join(&relative);
            if let Ok(canonical) = joined.canonicalize()
                && !canonical.starts_with(&canonical_root)
            {
                return Err(format!("File path escapes the repository: {path}"));
            }
            Ok(path.replace('\\', "/"))
        })
        .collect()
}

fn status_name(value: char) -> String {
    match value {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'U' => "conflicted",
        '?' => "untracked",
        ' ' => "unknown",
        _ => "unknown",
    }
    .into()
}

fn parse_files(root: &Path) -> Vec<GitChangedFile> {
    let Ok(output) = run_output(root, "git", &["status", "--porcelain=v1", "-z"]) else {
        return vec![];
    };
    if !output.status.success() {
        return vec![];
    }
    let values: Vec<&[u8]> = output.stdout.split(|byte| *byte == 0).collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < values.len() {
        let item = values[index];
        index += 1;
        if item.len() < 4 {
            continue;
        }
        let x = item[0] as char;
        let y = item[1] as char;
        let path = String::from_utf8_lossy(&item[3..]).into_owned();
        let mut old_path = None;
        if matches!(x, 'R' | 'C') && index < values.len() {
            old_path = Some(String::from_utf8_lossy(values[index]).into_owned());
            index += 1;
        }
        let untracked = x == '?' && y == '?';
        files.push(GitChangedFile {
            path,
            old_path,
            index_status: status_name(if untracked { '?' } else { x }),
            worktree_status: status_name(if untracked { '?' } else { y }),
            staged: !matches!(x, ' ' | '?'),
            partially_staged: !matches!(x, ' ' | '?') && y != ' ',
        });
    }
    files
}

fn parse_branches(root: &Path, ahead: i64, behind: i64) -> Vec<GitBranch> {
    let local = run_text(
        root,
        "git",
        &[
            "for-each-ref",
            "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)",
            "refs/heads",
        ],
    )
    .unwrap_or_default();
    let remote = run_text(
        root,
        "git",
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )
    .unwrap_or_default();
    let mut branches: Vec<GitBranch> = local
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let current = fields.next()?.trim() == "*";
            let name = fields.next()?.trim().to_string();
            let upstream = fields
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Some(GitBranch {
                name,
                current,
                remote: false,
                upstream,
                ahead: if current { ahead } else { 0 },
                behind: if current { behind } else { 0 },
            })
        })
        .collect();
    branches.extend(
        remote
            .lines()
            .filter(|name| !name.ends_with("/HEAD"))
            .map(|name| GitBranch {
                name: name.to_string(),
                current: false,
                remote: true,
                upstream: None,
                ahead: 0,
                behind: 0,
            }),
    );
    branches
}

fn parse_remotes(root: &Path) -> Vec<GitRemote> {
    let text = run_text(root, "git", &["remote", "-v"]).unwrap_or_default();
    let mut remotes: BTreeMap<String, (String, String)> = BTreeMap::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let Some(url) = parts.next() else { continue };
        let kind = parts.next().unwrap_or_default();
        let entry = remotes
            .entry(name.into())
            .or_insert_with(|| (String::new(), String::new()));
        if kind.contains("fetch") {
            entry.0 = url.into();
        } else if kind.contains("push") {
            entry.1 = url.into();
        }
    }
    remotes
        .into_iter()
        .map(|(name, (fetch_url, push_url))| GitRemote {
            name,
            fetch_url,
            push_url,
        })
        .collect()
}

fn parse_pull_requests(root: &Path, authenticated: bool) -> Vec<GitPullRequest> {
    if !authenticated {
        return vec![];
    }
    run_text(
        root,
        "gh",
        &[
            "pr",
            "list",
            "--limit",
            "20",
            "--json",
            "number,title,url,state,isDraft,statusCheckRollup",
        ],
    )
    .ok()
    .and_then(|value| serde_json::from_str::<Vec<serde_json::Value>>(&value).ok())
    .unwrap_or_default()
    .into_iter()
    .filter_map(|item| {
        Some(GitPullRequest {
            number: item.get("number")?.as_u64()?,
            title: item.get("title")?.as_str()?.into(),
            url: item.get("url")?.as_str()?.into(),
            state: item.get("state")?.as_str()?.into(),
            checks: item
                .get("statusCheckRollup")
                .and_then(|value| value.as_array())
                .map(|checks| format!("{} checks", checks.len()))
                .unwrap_or_else(|| "No checks".into()),
            draft: item
                .get("isDraft")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
        })
    })
    .collect()
}

fn empty_state(error: Option<String>) -> GitRepositoryState {
    GitRepositoryState {
        is_repository: false,
        root: None,
        head: None,
        detached: false,
        ahead: 0,
        behind: 0,
        merge_in_progress: false,
        rebase_in_progress: false,
        cherry_pick_in_progress: false,
        revert_in_progress: false,
        files: vec![],
        branches: vec![],
        stashes: vec![],
        tags: vec![],
        remotes: vec![],
        commits: vec![],
        pull_requests: vec![],
        github_authenticated: false,
        error,
    }
}

fn inspect(path: &str) -> GitRepositoryState {
    let Ok(root) = repository_root(path) else {
        return empty_state(None);
    };
    let head = run_text(&root, "git", &["branch", "--show-current"])
        .ok()
        .filter(|value| !value.is_empty());
    let counts = run_text(
        &root,
        "git",
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut count_parts = counts.split_whitespace();
    let behind = count_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let ahead = count_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let git_dir = run_text(&root, "git", &["rev-parse", "--git-dir"])
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        })
        .unwrap_or_else(|_| root.join(".git"));
    let commits = run_text(
        &root,
        "git",
        &[
            "log",
            "--all",
            "--topo-order",
            "--decorate=short",
            "-80",
            "--format=%h%x1f%s%x1f%an%x1f%ct%x1f%p%x1f%D",
        ],
    )
    .unwrap_or_default()
    .lines()
    .filter_map(|line| {
        let mut values = line.split('\u{1f}');
        Some(GitCommit {
            hash: values.next()?.into(),
            subject: values.next()?.into(),
            author: values.next()?.into(),
            timestamp: values.next()?.parse::<i64>().ok()? * 1000,
            parents: values
                .next()
                .unwrap_or_default()
                .split_whitespace()
                .map(str::to_string)
                .collect(),
            decorations: values
                .next()
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect(),
        })
    })
    .collect();
    let stashes = run_text(&root, "git", &["stash", "list", "--format=%gd%x09%gs"])
        .unwrap_or_default()
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let mut values = line.splitn(2, '\t');
            GitStash {
                index,
                reference: values.next().unwrap_or_default().into(),
                message: values.next().unwrap_or_default().into(),
            }
        })
        .collect();
    let tags = run_text(
        &root,
        "git",
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname:short)",
            "refs/tags",
        ],
    )
    .unwrap_or_default()
    .lines()
    .filter_map(|line| {
        let mut values = line.split('\t');
        Some(GitTag {
            name: values.next()?.into(),
            target: values.next()?.into(),
        })
    })
    .collect();
    let github_authenticated =
        run_output(&root, "gh", &["auth", "status"]).is_ok_and(|output| output.status.success());
    GitRepositoryState {
        is_repository: true,
        root: Some(root.to_string_lossy().into_owned()),
        head: head.clone(),
        detached: head.is_none(),
        ahead,
        behind,
        merge_in_progress: git_dir.join("MERGE_HEAD").exists(),
        rebase_in_progress: git_dir.join("rebase-merge").exists()
            || git_dir.join("rebase-apply").exists(),
        cherry_pick_in_progress: git_dir.join("CHERRY_PICK_HEAD").exists(),
        revert_in_progress: git_dir.join("REVERT_HEAD").exists(),
        files: parse_files(&root),
        branches: parse_branches(&root, ahead, behind),
        stashes,
        tags,
        remotes: parse_remotes(&root),
        commits,
        pull_requests: parse_pull_requests(&root, github_authenticated),
        github_authenticated,
        error: None,
    }
}

#[tauri::command]
pub fn git_repository_state(path: String) -> GitRepositoryState {
    inspect(&path)
}

fn repository_git_dir(root: &Path) -> Result<PathBuf, String> {
    let path = run_text(root, "git", &["rev-parse", "--absolute-git-dir"])?;
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("Git returned an invalid metadata path: {error}"))
}

#[tauri::command]
pub fn git_create_review_prompt(path: String, content: String) -> Result<String, String> {
    if content.is_empty() || content.len() > MAX_DIFF_BYTES {
        return Err("Git review request must be between 1 byte and 1 MB.".into());
    }
    let root = repository_root(&path)?;
    let directory = repository_git_dir(&root)?.join("codes-review-prompts");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not prepare the Git review request: {error}"))?;
    if let Ok(entries) = fs::read_dir(&directory) {
        for entry in entries.flatten() {
            let expired = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 86_400);
            if expired {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let prompt = directory.join(format!("{}.txt", Uuid::new_v4()));
    fs::write(&prompt, content)
        .map_err(|error| format!("Could not write the Git review request: {error}"))?;
    Ok(prompt.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn git_delete_review_prompt(path: String, prompt_path: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    let directory = repository_git_dir(&root)?.join("codes-review-prompts");
    let prompt = PathBuf::from(prompt_path)
        .canonicalize()
        .map_err(|error| format!("Git review request is unavailable: {error}"))?;
    let directory = directory
        .canonicalize()
        .map_err(|error| format!("Git review directory is unavailable: {error}"))?;
    if !prompt.starts_with(&directory)
        || prompt.extension().and_then(|value| value.to_str()) != Some("txt")
    {
        return Err("Git review request path is outside the repository metadata.".into());
    }
    fs::remove_file(prompt).map_err(|error| format!("Could not delete Git review request: {error}"))
}

#[tauri::command]
pub fn git_diff(path: String, file: Option<String>, staged: bool) -> Result<GitDiff, String> {
    let root = repository_root(&path)?;
    let safe_file = file
        .as_ref()
        .map(|value| safe_paths(&root, std::slice::from_ref(value)))
        .transpose()?
        .and_then(|mut values| values.pop());
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--no-ext-diff", "--no-color", "--"]);
    if let Some(value) = safe_file.as_deref() {
        args.push(value);
    }
    let mut output = run_output(&root, "git", &args)?;
    if output.status.success() && output.stdout.is_empty() && safe_file.is_some() && !staged {
        let file = safe_file.as_deref().unwrap_or_default();
        let tracked = run_output(&root, "git", &["ls-files", "--error-unmatch", "--", file])
            .is_ok_and(|value| value.status.success());
        if !tracked {
            output = run_output(
                &root,
                "git",
                &["diff", "--no-index", "--no-color", "--", "/dev/null", file],
            )?;
        }
    }
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    let binary = output
        .stdout
        .windows(17)
        .any(|window| window == b"Binary files differ");
    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let bytes = &output.stdout[..output.stdout.len().min(MAX_DIFF_BYTES)];
    Ok(GitDiff {
        path: safe_file,
        staged,
        binary,
        truncated,
        content: String::from_utf8_lossy(bytes).into_owned(),
    })
}

fn execute_operation(root: &Path, operation: &GitOperation) -> Result<String, String> {
    let output = match operation {
        GitOperation::Init => return Err("Repository is already initialized.".into()),
        GitOperation::Stage { paths } => {
            let paths = safe_paths(root, paths)?;
            let mut args = vec!["add", "--"];
            args.extend(paths.iter().map(String::as_str));
            run_text(root, "git", &args)?
        }
        GitOperation::Unstage { paths } => {
            let paths = safe_paths(root, paths)?;
            let has_head = run_output(root, "git", &["rev-parse", "--verify", "HEAD"])
                .is_ok_and(|output| output.status.success());
            let mut args = if has_head {
                vec!["restore", "--staged", "--"]
            } else {
                vec!["rm", "--cached", "--ignore-unmatch", "--"]
            };
            args.extend(paths.iter().map(String::as_str));
            run_text(root, "git", &args)?
        }
        GitOperation::StagePatch { patch } => run_with_input(
            root,
            "git",
            &[
                "apply",
                "--cached",
                "--unidiff-zero",
                "--whitespace=nowarn",
                "-",
            ],
            patch,
        )?,
        GitOperation::UnstagePatch { patch } => run_with_input(
            root,
            "git",
            &[
                "apply",
                "--cached",
                "--reverse",
                "--unidiff-zero",
                "--whitespace=nowarn",
                "-",
            ],
            patch,
        )?,
        GitOperation::Commit { message, amend } => {
            let message = message.trim();
            if message.is_empty() {
                return Err("Commit message cannot be empty.".into());
            }
            let mut args = vec!["commit", "-m", message];
            if amend.unwrap_or(false) {
                args.push("--amend");
            }
            run_text(root, "git", &args)?
        }
        GitOperation::CreateBranch { name, start_point } => {
            let name = safe_name(name, "Branch name")?;
            let mut args = vec!["switch", "-c", name.as_str()];
            let start = start_point
                .as_deref()
                .map(|value| safe_name(value, "Start point"))
                .transpose()?;
            if let Some(start) = start.as_deref() {
                args.push(start);
            }
            run_text(root, "git", &args)?
        }
        GitOperation::SwitchBranch { name } => {
            let name = safe_name(name, "Branch name")?;
            run_text(root, "git", &["switch", "--", &name])?
        }
        GitOperation::RenameBranch { name } => {
            let name = safe_name(name, "Branch name")?;
            run_text(root, "git", &["branch", "-m", "--", &name])?
        }
        GitOperation::DeleteBranch { name } => {
            let name = safe_name(name, "Branch name")?;
            run_text(root, "git", &["branch", "-d", "--", &name])?
        }
        GitOperation::Fetch { remote } => {
            let remote = remote
                .as_deref()
                .map(|value| safe_name(value, "Remote"))
                .transpose()?;
            if let Some(remote) = remote.as_deref() {
                run_text(root, "git", &["fetch", "--prune", remote])?
            } else {
                run_text(root, "git", &["fetch", "--all", "--prune"])?
            }
        }
        GitOperation::Pull {
            remote,
            branch,
            rebase,
        } => {
            let remote = remote
                .as_deref()
                .map(|value| safe_name(value, "Remote"))
                .transpose()?;
            let branch = branch
                .as_deref()
                .map(|value| safe_name(value, "Branch"))
                .transpose()?;
            let mut args = vec!["pull"];
            args.push(if rebase.unwrap_or(false) {
                "--rebase"
            } else {
                "--ff-only"
            });
            if let Some(remote) = remote.as_deref() {
                args.push(remote);
            }
            if let Some(branch) = branch.as_deref() {
                args.push(branch);
            }
            run_text(root, "git", &args)?
        }
        GitOperation::Push {
            remote,
            branch,
            set_upstream,
        } => {
            let remote = safe_name(remote, "Remote")?;
            let branch = safe_name(branch, "Branch")?;
            let mut args = vec!["push"];
            if set_upstream.unwrap_or(false) {
                args.push("-u");
            }
            args.extend([remote.as_str(), branch.as_str()]);
            run_text(root, "git", &args)?
        }
        GitOperation::Stash {
            message,
            include_untracked,
        } => {
            let mut args = vec!["stash", "push"];
            if include_untracked.unwrap_or(false) {
                args.push("--include-untracked");
            }
            let message = message.as_deref().map(str::trim).filter(|v| !v.is_empty());
            if let Some(message) = message {
                args.extend(["-m", message]);
            }
            run_text(root, "git", &args)?
        }
        GitOperation::StashApply { index, pop } => {
            let reference = format!("stash@{{{index}}}");
            run_text(
                root,
                "git",
                &[
                    "stash",
                    if pop.unwrap_or(false) { "pop" } else { "apply" },
                    &reference,
                ],
            )?
        }
        GitOperation::CreateTag {
            name,
            target,
            message,
        } => {
            let name = safe_name(name, "Tag name")?;
            let target = target
                .as_deref()
                .map(|value| safe_name(value, "Tag target"))
                .transpose()?;
            let mut args = vec!["tag"];
            if let Some(message) = message.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                args.extend(["-a", name.as_str(), "-m", message]);
            } else {
                args.push(name.as_str());
            }
            if let Some(target) = target.as_deref() {
                args.push(target);
            }
            run_text(root, "git", &args)?
        }
        GitOperation::DeleteTag { name } => {
            let name = safe_name(name, "Tag name")?;
            run_text(root, "git", &["tag", "-d", &name])?
        }
        GitOperation::Merge { branch } => {
            let branch = safe_name(branch, "Branch")?;
            run_text(root, "git", &["merge", "--no-edit", "--", &branch])?
        }
        GitOperation::Rebase { branch } => {
            let branch = safe_name(branch, "Branch")?;
            run_text(root, "git", &["rebase", "--", &branch])?
        }
        GitOperation::CherryPick { revision } => {
            let revision = safe_name(revision, "Revision")?;
            run_text(root, "git", &["cherry-pick", "--", &revision])?
        }
        GitOperation::Revert { revision } => {
            let revision = safe_name(revision, "Revision")?;
            run_text(root, "git", &["revert", "--no-edit", "--", &revision])?
        }
        GitOperation::Continue { operation } => match operation.as_str() {
            "merge" => run_text(root, "git", &["merge", "--continue"])?,
            "rebase" => run_text(root, "git", &["rebase", "--continue"])?,
            "cherry_pick" => run_text(root, "git", &["cherry-pick", "--continue"])?,
            "revert" => run_text(root, "git", &["revert", "--continue"])?,
            _ => return Err("Unsupported continue operation.".into()),
        },
        GitOperation::Abort { operation } => match operation.as_str() {
            "merge" => run_text(root, "git", &["merge", "--abort"])?,
            "rebase" => run_text(root, "git", &["rebase", "--abort"])?,
            "cherry_pick" => run_text(root, "git", &["cherry-pick", "--abort"])?,
            "revert" => run_text(root, "git", &["revert", "--abort"])?,
            _ => return Err("Unsupported abort operation.".into()),
        },
        GitOperation::AddRemote { name, url } => {
            let name = safe_name(name, "Remote name")?;
            let url = safe_name(url, "Remote URL")?;
            run_text(root, "git", &["remote", "add", &name, &url])?
        }
        GitOperation::RemoveRemote { name } => {
            let name = safe_name(name, "Remote name")?;
            run_text(root, "git", &["remote", "remove", &name])?
        }
        GitOperation::CreatePr {
            title,
            body,
            base,
            draft,
        } => {
            if title.trim().is_empty() {
                return Err("Pull request title cannot be empty.".into());
            }
            let mut args = vec!["pr", "create", "--title", title.trim(), "--body", body];
            let base = base
                .as_deref()
                .map(|value| safe_name(value, "Base branch"))
                .transpose()?;
            if let Some(base) = base.as_deref() {
                args.extend(["--base", base]);
            }
            if draft.unwrap_or(false) {
                args.push("--draft");
            }
            run_text(root, "gh", &args)?
        }
        GitOperation::CheckoutPr { number } => {
            run_text(root, "gh", &["pr", "checkout", &number.to_string()])?
        }
        GitOperation::MarkPrReady { number } => {
            run_text(root, "gh", &["pr", "ready", &number.to_string()])?
        }
    };
    Ok(output)
}

#[tauri::command]
pub fn git_execute(
    path: String,
    operation: GitOperation,
    state: State<'_, AppState>,
) -> Result<GitOperationResult, String> {
    let _guard = GIT_OPERATION_LOCK
        .lock()
        .map_err(|_| "Git operation lock is unavailable.".to_string())?;
    if matches!(operation, GitOperation::Init) {
        let directory = canonical_directory(&path)?;
        let output = run_text(&directory, "git", &["init"])?;
        return Ok(GitOperationResult {
            output,
            state: inspect(&path),
        });
    }
    let root = repository_root(&path)?;
    let operation_json = serde_json::to_string(&operation).map_err(|error| error.to_string())?;
    let result = execute_operation(&root, &operation);
    let (status, detail) = match &result {
        Ok(output) => ("completed", output.clone()),
        Err(error) => ("failed", error.clone()),
    };
    let _ = state.database.lock().execute(
        "INSERT INTO git_operation_audit(id,repository_path,operation_json,status,detail,occurred_at) VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            Uuid::new_v4().to_string(),
            root.to_string_lossy(),
            operation_json,
            status,
            detail,
            now_ms()
        ],
    );
    let output = result?;
    Ok(GitOperationResult {
        output,
        state: inspect(&path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init_repo() -> tempfile::TempDir {
        let directory = tempfile::tempdir().expect("temporary repository");
        run_text(directory.path(), "git", &["init"]).expect("git init");
        run_text(
            directory.path(),
            "git",
            &["config", "user.email", "test@example.com"],
        )
        .expect("git email");
        run_text(
            directory.path(),
            "git",
            &["config", "user.name", "CoDes Test"],
        )
        .expect("git name");
        directory
    }

    #[test]
    fn rejects_paths_outside_repository() {
        let directory = init_repo();
        assert!(safe_paths(directory.path(), &["../secret".into()]).is_err());
    }

    #[test]
    fn stages_and_commits_selected_file() {
        let directory = init_repo();
        fs::write(directory.path().join("readme.txt"), "hello").expect("write fixture");
        execute_operation(
            directory.path(),
            &GitOperation::Stage {
                paths: vec!["readme.txt".into()],
            },
        )
        .expect("stage");
        execute_operation(
            directory.path(),
            &GitOperation::Commit {
                message: "test: add fixture".into(),
                amend: Some(false),
            },
        )
        .expect("commit");
        assert_eq!(
            run_text(directory.path(), "git", &["log", "-1", "--format=%s"]).unwrap(),
            "test: add fixture"
        );
    }

    #[test]
    fn stores_large_review_prompts_outside_the_process_arguments() {
        let directory = init_repo();
        let repository = directory.path().to_string_lossy().into_owned();
        let content = "review this diff\n".repeat(10_000);
        let prompt =
            git_create_review_prompt(repository.clone(), content.clone()).expect("create prompt");
        assert_eq!(fs::read_to_string(&prompt).expect("read prompt"), content);
        assert!(
            PathBuf::from(&prompt)
                .starts_with(repository_git_dir(directory.path()).expect("git metadata"))
        );
        git_delete_review_prompt(repository, prompt.clone()).expect("delete prompt");
        assert!(!PathBuf::from(prompt).exists());
    }

    #[test]
    fn operation_type_has_no_force_push_or_hard_reset() {
        assert!(
            serde_json::from_str::<GitOperation>(
                r#"{"kind":"push","remote":"origin","branch":"main","force":true}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<GitOperation>(r#"{"kind":"hard_reset","revision":"HEAD"}"#)
                .is_err()
        );
    }
}
