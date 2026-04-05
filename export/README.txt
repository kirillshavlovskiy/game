Pending changes vs current HEAD at export time (branch main, base commit 8adc020d3a813c5355950feeacb09f7df2b7f940).
Working-tree edits under the repo root are captured in ALL-CHANGES.patch; the patch file itself is omitted from the diff so it does not recurse.

Files in this folder
--------------------
ALL-CHANGES.patch              Unified diff for all changed paths except this file (apply from repo root).
discarded-commit-1e0b938.txt   Full copy (git may treat long .txt as binary in some diffs).
git-commits.txt                Full copy.
.gitignore                     Copy of repo-root .gitignore at export time.

If the patch ends with "Binary files differ" for large .txt dumps, use the copies here instead of relying on the patch for those files.

Regenerate this export (from repo root)
----------------------------------------
Copy the text dumps and .gitignore snapshot, then write the unified diff. Prefer --output so the patch is UTF-8
without a BOM (PowerShell Set-Content / cmd > can add BOM or UTF-16 and break git apply).

  Copy-Item -Force git-commits.txt, discarded-commit-1e0b938.txt export\   (PowerShell)
  copy /Y git-commits.txt export\ && copy /Y discarded-commit-1e0b938.txt export\   (cmd)
  copy /Y .gitignore export\.gitignore

  Put --output before -- (Git treats everything after -- as pathspecs; --output after -- breaks the patch).

  git diff --output=export/ALL-CHANGES.patch HEAD -- . ":(exclude)export/ALL-CHANGES.patch"

  To export only what is staged: git diff --cached --output=export/ALL-CHANGES.patch HEAD -- . ":(exclude)export/ALL-CHANGES.patch"

  If git apply fails on "Binary files … differ" blocks (e.g. removed PNGs under public/), regenerate with an extra
  pathspec after --, e.g. ... HEAD -- . ":(exclude)export/ALL-CHANGES.patch" ":(exclude)public", then sync public/
  manually on the other machine.

(Older narrow path list — app components lib next.config.js … — still works if you only change those trees; the "."
 form matches the full working tree vs HEAD.)

Verify apply on a clean tree at the same parent commit
--------------------------------------------------------
  git stash push -u -m "temp" stashes untracked files too, so copy the patch aside first if export/ALL-CHANGES.patch
  is not tracked:

  Copy-Item -Force export\ALL-CHANGES.patch $env:TEMP\ALL-CHANGES.patch   (PowerShell)
  git stash push -u -m "temp"
  git apply --check $env:TEMP\ALL-CHANGES.patch
  git stash pop

  If the patch file is tracked or lives outside the repo, you can run git apply --check on it directly after stash.

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
