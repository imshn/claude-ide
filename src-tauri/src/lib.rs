mod approval;
mod claude;
mod fsops;
mod git;
mod intel;
mod pty;
mod search;
mod shellenv;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(claude::Sessions::default())
        .manage(pty::Terminals::default())
        .manage(approval::Approvals::default())
        .invoke_handler(tauri::generate_handler![
            fsops::list_dir,
            fsops::read_file,
            fsops::write_file,
            fsops::delete_file,
            fsops::path_exists,
            git::git_status,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_branches,
            git::git_checkout,
            git::git_log,
            git::git_repo_root,
            git::git_init,
            git::git_file_diff,
            git::checkpoint_create,
            git::checkpoint_changes,
            git::file_at_tree,
            intel::project_intel,
            search::repo_search,
            approval::approval_setup,
            approval::approval_respond,
            approval::approval_stats,
            claude::claude_detect,
            claude::claude_start,
            claude::claude_send,
            claude::claude_stop,
            claude::claude_running,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Claude IDE");
}
