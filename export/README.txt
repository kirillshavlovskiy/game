Pending changes vs current HEAD at export time (branch main, base commit 7fad801).
Staged and unstaged edits under the repo root are captured in ALL-CHANGES.patch; the patch file itself is omitted from the diff so it does not recurse.

Files in this folder
--------------------
ALL-CHANGES.patch              Unified diff for all changed paths except this file (apply from repo root).
discarded-commit-1e0b938.txt   Full copy (git may treat long .txt as binary in some diffs).
git-commits.txt                Full copy.
.gitignore                     Copy of repo-root .gitignore at export time.

If the patch ends with "Binary files differ" for large .txt dumps, use the copies here instead of relying on the patch for those files.

Regenerate this export (from repo root)
----------------------------------------
PowerShell:

  Copy-Item -Force git-commits.txt, discarded-commit-1e0b938.txt export\
  Copy-Item -Force .gitignore export\.gitignore
  git diff HEAD -- . ":(exclude)export/ALL-CHANGES.patch" | Set-Content -Encoding utf8 export\ALL-CHANGES.patch

cmd.exe:

  copy /Y git-commits.txt export\
  copy /Y discarded-commit-1e0b938.txt export\
  copy /Y .gitignore export\.gitignore
  git diff HEAD -- . ":(exclude)export/ALL-CHANGES.patch" > export/ALL-CHANGES.patch

(Older narrow path list — app components lib … — still works if you only change those trees; the "." form matches the full working tree.)

Verify apply on a clean tree at the same parent commit
--------------------------------------------------------
  git stash push -u -m "temp"
  git apply --check export/ALL-CHANGES.patch
  git stash pop

If you get git back later (from repo root)
--------------------------------------------
  git apply --check export/ALL-CHANGES.patch
  git apply export/ALL-CHANGES.patch
  copy export\discarded-commit-1e0b938.txt .
  copy export\git-commits.txt .
  copy export\.gitignore .

Without git
-----------
Use a visual diff tool to compare ALL-CHANGES.patch to your tree, or install GNU patch
and run: patch -p1 < export/ALL-CHANGES.patch
Then copy the three files above into the project root next to package.json.
