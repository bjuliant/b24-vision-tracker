# VisionBot Test Queue

Use this as an end-user test script. Do not fix issues during the queue; record them, then implement after the user says: `test queue complete`.

## Rules

- Test one item at a time.
- Record: pass, fail, confusing, or blocked.
- Capture the command used and the visible result.
- If something fails, continue to the next unrelated item when possible.
- Do not change GitHub, Supabase, or Render during this queue unless explicitly restarting a deployed test is part of the item.

## Phase 1: Bot Health And Access

- [ ] DM `/status`
- [ ] Approved group `/status`
- [ ] Approved group `@status`
- [ ] Approved group `/map`
- [ ] Approved group `@map`
- [ ] Approved group `/help`
- [ ] Approved group `@help`
- [ ] Approved group `$help`
- [ ] DM `!help`
- [ ] DM `$help` should be rejected with a clear message.
- [ ] Unapproved/test group operational command should reject clearly.
- [ ] Unapproved/test group intel command should reject clearly.
- [ ] Unknown command like `$attck` should suggest `$attack`.

## Phase 2: Public Intel

- [ ] `$B24` shows a galaxy summary.
- [ ] `$B24:36` shows a region summary.
- [ ] `$B24:02:76:10` posts astro intel in an approved/access chat.
- [ ] `!B24:02:76:10` DMs astro intel privately.
- [ ] `$B24:02:76` lists all known astros in the system.
- [ ] `$B24 02 76 10` works.
- [ ] `$24 02 76 10` works.
- [ ] `$24027610` works.
- [ ] Unauthorized users cannot use intel commands.
- [ ] Intel does not show saved-user notes or private saved-base info unless authorized.
- [ ] Public intel buttons work: Open Map.
- [ ] `Bases` button is blocked for unauthorized users.
- [ ] `$astros` shows a galaxy terrain breakdown.
- [ ] `$astros 44 craters` lists matching astros in B24:44.
- [ ] `$astros 24 44 craters` lists matching astros in B24:44.

## Phase 3: Saved Bases And Private Intel

- [ ] `!mine B24:45:10:30 note`
- [ ] `!me`
- [ ] `!me bases`
- [ ] `!save me B24:45:10:30 defense note`
- [ ] `!bases <your name>`
- [ ] `!bases [guild tag/player]`
- [ ] Partial player search with multiple matches gives helpful suggestions.
- [ ] Authorized coordinate intel can show saved-base info where appropriate.

## Phase 4: Basic Operations

- [ ] `$attack B24:11:70:31 60 single target test`
- [ ] `$board attack` shows the new operation.
- [ ] `!join <attack-id> 30 fighters`
- [ ] `!ready <attack-id>`
- [ ] `!sent <attack-id> fleet sent`
- [ ] `$op <attack-id>` shows updated joined/ready/sent counts.
- [ ] `$standdown <attack-id> test complete`
- [ ] `$board attack` no longer shows the stood-down operation.

## Phase 5: Generic Attack Pool

- [ ] `$attack 02:00 B24:11:70:31 B24:14:89:10 B24:17:35:20 test wave`
- [ ] `$board attack` shows one attack plan and multiple targets.
- [ ] `!take <attack-id> B24:14:89:10 02:30 fighters`
- [ ] `$board attack` shows that target as claimed.
- [ ] Another user cannot claim the already-claimed target.
- [ ] Another user can claim a different open target.
- [ ] `!sent <attack-id> note` updates the linked claim as confirmed.
- [ ] `$standdown <attack-id>` closes the pool and linked claims.

## Phase 6: Defense And Incoming

- [ ] `$sos B24:45:10:30 B24:44:76:10 45 incoming test`
- [ ] `$board defense` shows defended base and hostile origin.
- [ ] `!respond <defense-id> 20 defender`
- [ ] `!ready <defense-id>`
- [ ] `!sent <defense-id>`
- [ ] `!incoming`
- [ ] `$standdown <defense-id>`

## Phase 7: Scouting

- [ ] `$scout B24:44:76 120 scout request`
- [ ] `$scout 44 76 120 scout request`
- [ ] `$board scout`
- [ ] `!join <scout-id> scout`
- [ ] `!ready <scout-id>`
- [ ] `!sent <scout-id> scouted`
- [ ] `$standdown <scout-id>`

## Phase 8: Mini App Basics

- [ ] Open Mini App from Telegram button.
- [ ] Map loads current galaxy.
- [ ] Switch/select sectors.
- [ ] Sector intel panel updates.
- [ ] Mark sector Friend.
- [ ] Mark sector Enemy.
- [ ] Mark sector Scout.
- [ ] Mark sector Reserved.
- [ ] Clear sector.
- [ ] Existing Supabase intel appears after refresh.

## Phase 9: Mini App Bulk Attack Setup

- [ ] Paste copied target lines into Bulk Target Input.
- [ ] Parsed target count appears.
- [ ] Claim/finalize controls are disabled before selecting landing window.
- [ ] Select 4 hour landing window.
- [ ] Per-target wave dropdowns populate.
- [ ] Claim one row manually.
- [ ] Finalize remaining rows.
- [ ] Claims appear in Mini App Attack Board.
- [ ] `$board attack` in Telegram shows Mini App-created claims.
- [ ] Mini App refuses live claims if opened without Telegram group scope.

## Phase 10: Cross-Direction Sync

- [ ] Create operation in Telegram, refresh Mini App, verify it appears.
- [ ] Create/finalize claims in Mini App, run `$board attack`, verify they appear.
- [ ] Confirm sent in Mini App, verify Telegram board reflects it if supported.
- [ ] `!sent` in Telegram, verify Mini App shows confirmed if linked claim exists.
- [ ] Stand down in Telegram, verify Mini App no longer shows active claims/operation.

## Phase 11: Usability Notes

- [ ] Any command wording feels confusing.
- [ ] Any bot response is too long or too terse.
- [ ] Any button label is unclear.
- [ ] Any Mini App section feels too crowded.
- [ ] Any error message fails to tell the user what to do next.
- [ ] Any test requires too much typing.

## Final Review

- [ ] User says `test queue complete`.
- [ ] Group failures by severity.
- [ ] Group usability issues by screen/command.
- [ ] Decide implementation order.
