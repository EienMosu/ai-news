# AI News — Deployment Runbook

This is for whoever is at the terminal deploying, verifying, or moving this system, and it
assumes nothing was read beforehand. Follow it top to bottom. Nothing in this project has been
deployed yet — every task up to this one stops at `cdk synth`.

Account: `356117015048`. Region: `eu-central-1`. Stack: `AiNewsStack`. Expected run cost:
**$12–18/month**, almost all Bedrock.

---

## GO / NO-GO — read this before step 4, not after

This account already has two budgets it did not get from this project:

| Name | Limit | What happens to it |
|---|---|---|
| `My Zero-Spend Budget` | $1 | Fires on the first day this system ranks anything. Bedrock has **no always-free tier** — there is no way to stay under $1 while running. |
| `My Monthly Cost Budget 10USD` | $10 | Fires most months. This system alone is expected to cost $12–18/month. |

Both will misfire **every month, under normal operation, forever** — not as a one-time
teething problem. A budget alert that cries wolf monthly gets ignored within a week, and that
is the exact state in which a real overspend goes unnoticed. This is a decision, not a
footnote: for each of the two budgets, before you run step 4, decide to

- **delete it**,
- **raise it** above $12–18/month, or
- **knowingly accept** the monthly noise and tell whoever else gets the email why.

This plan deliberately does not touch either budget — they predate it and are yours to manage.
It also does not touch the `HelloWorld` Lambda that already exists in this account; the
CloudWatch alarms below are per-function and ignore it, but the two account-wide budgets above
will include its (near-zero) cost.

Record whichever decision you make somewhere durable, then continue to step 1.

---

## Deploy (first time)

1. **Confirm you're in the right account before touching anything.**
   ```
   aws sts get-caller-identity
   ```
   Check `"Account"` reads `356117015048`. If it doesn't, stop — every step below is scoped to
   that account and region, and running them against the wrong one is not something this
   runbook, or the CDK stack, will catch for you.

2. **Bootstrap CDK.** This account has never had `cdk bootstrap` run in it.
   ```
   pnpm cdk bootstrap aws://356117015048/eu-central-1
   ```
   If this ever reports already bootstrapped, that's fine — it's idempotent. Skipping it on a
   truly fresh account is not: `cdk deploy` in step 4 will fail on a missing bootstrap stack.

3. **Create the GitHub PAT. Human only — never an agent, never Claude.** Scope it to
   `contents:write` on `EienMosu/ai-news` only, nothing broader. Then store it:
   ```
   aws ssm put-parameter --name /ai-news/github-token --type SecureString --value '<PAT>' --region eu-central-1
   ```
   **Shell-history caveat:** that command puts the PAT in your shell history in plain text
   unless you do something about it. Either prefix the whole command with a single space (most
   shells with `HISTCONTROL=ignorespace`/`HIST_IGNORE_SPACE` skip logging it), or pass
   `--value file:///path/to/pat.txt` and delete the file immediately after. Don't paste the PAT
   into a chat window, an agent, or this terminal's scrollback if you can avoid it.

4. **Deploy.**
   ```
   pnpm cdk deploy -c alertEmail=<your-email>
   ```
   This is the point of no return for the GO/NO-GO gate above — if you haven't made the budget
   decision yet, stop and go back to it now.

   **When it finishes, `cdk deploy` prints an `Outputs:` block** with four values:
   `AiNewsStack.TableName`, `AiNewsStack.CaptureFunctionName`, `AiNewsStack.RankFunctionName`,
   and `AiNewsStack.VercelReaderUserName`. Every one of them is a name CDK generated at deploy
   time — none of the four resources is named the way its logical ID suggests (the table
   itself, in particular, synthesizes as `AWS::DynamoDB::GlobalTable`, so even hunting for "the
   DynamoDB table" by resource type in the console will not find it under a name you'd
   recognize). Copy all four now and export them for the rest of this session — steps 6-8 and
   10 all read straight from these:
   ```
   export TABLE_NAME=<the TableName output>
   export CAPTURE_FN=<the CaptureFunctionName output>
   export RANK_FN=<the RankFunctionName output>
   export VERCEL_USER=<the VercelReaderUserName output>
   ```
   Opening a new terminal later, or coming back to this weeks from now? These don't persist
   between shells. Get them again with:
   ```
   aws cloudformation describe-stacks --stack-name AiNewsStack --query "Stacks[0].Outputs"
   ```

5. **Confirm the SNS subscription email.** AWS just sent an email to `<your-email>` with a
   "Confirm subscription" link. Click it now.

   **This is the single easiest step in this whole runbook to skip, and the most expensive to
   have skipped.** Until that link is clicked, the subscription sits in `PendingConfirmation`
   and *every one of the three alarms below, plus both of this stack's own budgets, deliver
   nothing* — while the stack, the topic, and the alarms all report healthy in the console.
   There is no error, no failed deployment, no red X anywhere. The system simply monitors
   itself for an audience of no one until you click that link. Step 6 checks for exactly this,
   but don't rely on that — click it now while it's in front of you.

6. **Run the smoke script with the Bedrock check included.**
   ```
   pnpm smoke --with-bedrock
   ```
   This needs `TABLE_NAME` exported (step 4) — if you skipped that or it's unset, the script
   says so itself, once, and tells you the exact command to get it, rather than running anyway
   and dumping raw AWS errors.

   This is a read-only check of the table, the last capture run, the last few days, the GitHub
   token parameter, the alerts subscription, and the schedules — plus, because you passed
   `--with-bedrock`, one live Bedrock call proving the ranking model actually works with the
   IAM policy you just deployed. That one call costs about **$0.0001** (a 16-token response);
   it is the only thing in this entire project that spends money outside of normal operation,
   which is why it's opt-in everywhere else. Expect `lastRun` to report absent and `days` to
   report "no days recorded yet" at this point — capture hasn't run yet. That's normal; step 7
   fixes it.

7. **Invoke capture once, by hand, then re-check.**
   ```
   aws lambda invoke --function-name "$CAPTURE_FN" /dev/stdout
   ```
   (`$CAPTURE_FN` is the `CaptureFunctionName` output from step 4. If it's unset because you're
   in a new shell, re-fetch it with the `describe-stacks` command shown there.) Then re-run
   `pnpm smoke` and confirm the `lastRun` check reports `itemsWritten > 0`.

   **Do this promptly, and expect one alarm email before you do.** The `CaptureStopped` alarm
   uses `treatMissingData: BREACHING`, which treats *no data yet* the same as *zero* — so on a
   brand new deploy, before capture has ever run, it can and likely will fire once, and you'll
   get an email saying so. **That is expected, not a fault.** It's the same property that makes
   the alarm useful at all: a stopped EventBridge schedule publishes no datapoints either, and
   BREACHING is what turns "no datapoints" into a page instead of permanent silence. Invoking
   capture here publishes the first real datapoint and the alarm clears itself.

   One more thing worth knowing before it surprises you later: after a genuine stoppage (not
   this one-time deploy case), this alarm doesn't fire within the hour — it fires roughly
   **25–50 hours later**. The metric window is 25 hours, deliberately wider than the 1-hour
   capture schedule, so that one missed run doesn't page anyone. The cost of that tolerance is
   detection latency on a real outage; that trade was made on purpose.

8. **Invoke rank once, by hand, for today.**
   ```
   aws lambda invoke --function-name "$RANK_FN" \
     --cli-binary-format raw-in-base64-out \
     --payload '{"day":"<today, YYYY-MM-DD, Istanbul calendar day>"}' /dev/stdout
   ```
   "Today" means the Istanbul (UTC+3, no DST) calendar date — the same one capture just wrote
   articles under in step 7. This is almost always just today's date wherever you are; it only
   diverges right around midnight UTC+3. Deliberately **not** "yesterday": the automatic 06:00
   schedule always ranks the previous day, but this manual call passes an explicit `day` so it
   ranks the day you just populated, not the one before it.

   **What this call does, and does not, finish.** It scores today's articles so far and backs
   them up — enough to confirm the pipeline works end to end. It will **not** mark today
   `"complete"`, no matter how cleanly it runs: rank refuses to finalize any day that has not
   ended yet, today included, regardless of what `day` you pass it. Today stays `"partial"`
   until the automatic 06:00 run finalizes it tomorrow morning, once the rest of today's
   articles have actually been captured. This is deliberate, not a limitation to work around —
   there is no follow-up call needed here.

   **`--cli-binary-format raw-in-base64-out` is not optional here, and its absence fails before
   the call ever reaches AWS.** The `--payload` here is a raw JSON string, but AWS CLI v2
   treats Lambda's `Payload` parameter as a binary blob and expects base64 by default — without
   this flag you get `Invalid base64: "{...}"` from the CLI itself, on every stock v2 install.
   (`$RANK_FN` is the `RankFunctionName` output from step 4, same caveat as `$CAPTURE_FN` above
   if you're in a new shell.)

9. **Confirm the backup landed.** Check that `archive/<the day you ranked in step 8>.ndjson`
   exists in `https://github.com/EienMosu/ai-news`. If it's missing, re-run `pnpm smoke` first
   — a missing GitHub token parameter or a bad PAT scope is the most likely cause, and the
   `github token` check will tell you which.

10. **Mint the Vercel access key. Human only — never an agent, never Claude.**
    IAM console → Users → search for `$VERCEL_USER` (the `VercelReaderUserName` output from
    step 4 — the user is **not** literally named `VercelReader` in the console; CloudFormation
    generated its real name at deploy time, the same way it did for the table and both
    functions) → Create access key → paste the key ID and secret directly into Vercel's
    environment variables. **Do not write it to a file. Do not echo it to this terminal. Do not
    paste it into a chat window.** The CDK stack deliberately does not create this key itself
    — CloudFormation has no way to hand you the secret half of an access key without
    persisting it somewhere you'd then have to secure separately anyway, so the stack only
    creates the user the key belongs to, and minting the key is left to this manual step.

    ⚠️ **This key is invisible to CDK, permanently.** Because it's minted outside the stack,
    `cdk diff` will never mention it, before or after it exists. If a future change ever forces
    replacement of the `VercelReader` user construct (renaming it, changing an ID in the
    construct tree, etc.), CloudFormation destroys the old user — and the key with it —
    *silently*. There is no warning in the diff, no alarm, nothing. The site just starts
    returning errors in production with no deployment event to point at. If you ever touch that
    construct, re-mint the key and update Vercel in the same change, not after you notice
    something broke.

---

## Verifying a healthy deploy, day to day

```
export TABLE_NAME=<the TableName output — see step 4, or re-fetch it with describe-stacks>
pnpm smoke                 # free — everything except the Bedrock round trip
pnpm smoke --with-bedrock  # adds one ~$0.0001 live Bedrock call
```

Read the failures literally — each one names the specific thing that's wrong (a table not
ACTIVE, a subscription still `PendingConfirmation`, a schedule that's `DISABLED`, a source with
a non-zero quarantine count) rather than a generic "something's wrong." If `TABLE_NAME` isn't
set, the script says exactly that, once, with the command to get it, instead of running the
table-, last-run-, and days-checks anyway and dumping three separate raw AWS validation errors.
If everything else reports `FAIL`, that means the resources genuinely don't exist yet (nothing
deployed) — it does not mean the script itself is broken.

## Rollback

```
pnpm cdk destroy
```

This removes the two Lambda functions, all three schedules (hourly capture, the 06:00 final
rank, and the 18:00 interim rank), all three alarms, the SNS topic and subscription, and both
of this stack's own budgets ($25/$40 — not the two pre-existing account budgets, which this
project never touched and `destroy` has no power over).

**The DynamoDB table is `RETAIN` and survives this on purpose.** It holds the entire archive.
`cdk destroy` will not touch it. To actually remove it: confirm the GitHub `archive/*.ndjson`
copies are current, then delete the table explicitly in the console. There is no CDK path that
deletes it — that's deliberate, not an oversight.

## Moving to another AWS account

Nothing here requires editing source code — that portability is a hard requirement (spec §2),
and if some future change breaks it, this is the list that will expose it.

1. `aws configure --profile new` — set up credentials for the target account.
2. `pnpm cdk bootstrap --profile new aws://<new-account-id>/<region>`
3. Recreate the SSM parameter in the new account (repeat step 3 above, with `--profile new` and
   a fresh PAT — SSM parameters do not travel between accounts).
4. **Request Bedrock model access for `anthropic.claude-sonnet-4-6` in the new account.** This
   is the step most likely to block the migration: model access is granted per-account, is
   console-gated (there is no CLI request path), and can take anywhere from instant to a
   support-ticket's worth of time. Confirm it landed with:
   ```
   aws bedrock list-inference-profiles --profile new --region <region>
   ```
   and look for `global.anthropic.claude-sonnet-4-6` with status `ACTIVE` before deploying.
5. `pnpm cdk deploy --profile new -c alertEmail=<email>`
6. Backfill history by replaying `archive/*.ndjson` from GitHub into the new table (there is no
   built-in replay tool in this project yet — this is a manual write pass against the same
   `pk`/`sk` shape the capture Lambda writes).

Note that the new account starts with none of the account-wide budget baggage described in the
GO/NO-GO section above — but check whether it has its own pre-existing budgets before assuming
otherwise, and repeat that same decision if it does.

---

## Reference

- **Model:** `global.anthropic.claude-sonnet-4-6` — the `global.` prefix is mandatory (not an
  EU-residency option): this model has no in-region on-demand availability outside `eu-west-2`,
  and regional prefixes like `eu.` carry a 10% pricing premium. Access is already granted and
  verified `ACTIVE`/invokable in `eu-central-1` — you do not need to request it for this
  account.
- **Backup target:** GitHub repo `EienMosu/ai-news`, path `archive/<day>.ndjson`.
- **GitHub token parameter:** `/ai-news/github-token` (SecureString, `eu-central-1`).
- Table, both function, and the Vercel IAM user's physical names are all CDK-generated (none
  is hardcoded to what its logical ID suggests). The stack outputs all four — see step 4. If
  you've lost them, `aws cloudformation describe-stacks --stack-name AiNewsStack --query
  "Stacks[0].Outputs"` gets them back any time after deploy, no matter how long ago.
