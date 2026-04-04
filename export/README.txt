Pending changes vs current HEAD (branch main, in sync with origin/main at export time).
Staged edits are captured below; ALL-CHANGES.patch omits itself so the diff file is not recursive.

Files in this folder
--------------------
ALL-CHANGES.patch     Unified diff for all changed paths except this file (apply from repo root).
discarded-commit-1e0b938.txt   Full copy (git may treat long .txt as binary in some diffs).
git-commits.txt                Full copy.
.gitignore                     Copy of repo-root .gitignore at export time.

The patch ends with two "Binary files differ" entries for the .txt dumps; use the
copies here instead of relying on the patch for those two files.

Regenerate this export (from repo root)
----------------------------------------
  copy /Y discarded-commit-1e0b938.txt export\
  copy /Y git-commits.txt export\
  copy /Y .gitignore export\.gitignore
  git diff HEAD -- app components lib next.config.js export/.gitignore export/README.txt export/discarded-commit-1e0b938.txt export/git-commits.txt > export/ALL-CHANGES.patch

Verify apply on a clean tree at the same parent commit
------------------------------------------------------
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
