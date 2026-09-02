# Email setup — verifying quiettruths.co.ke in Resend

Confirmation emails are sent BY the app TO each new user's own email.
`write@quiettruths.co.ke` is NOT involved — it's only the Contact-page address.

To let the app email real users (not just your own inbox), verify your domain once.

## Step 1 — Add the domain in Resend
1. Go to https://resend.com/domains
2. Click **Add Domain**
3. Enter: `quiettruths.co.ke`
4. Region: pick the closest (e.g. `eu-west-1` or `us-east-1` — doesn't matter much)
5. Click **Add**

## Step 2 — Copy the DNS records Resend shows you
Resend will display a table of records to add. Usually:
- 1 × **MX** record  (for the "send" subdomain, e.g. `send.quiettruths.co.ke`)
- 1 × **TXT** record for **SPF**  (value starts with `v=spf1 ... include:amazonses.com ...`)
- 1 × **TXT** record for **DKIM** (a long `resend._domainkey ...` value)
- (sometimes) 1 × **TXT** for **DMARC**

Leave that Resend tab open — you'll click **Verify** after Step 3.

## Step 3 — Paste them into your domain's DNS
Log in to wherever you manage quiettruths.co.ke DNS (your registrar or web host —
the same place that runs your write@ mailbox; often cPanel → "Zone Editor",
or the registrar's DNS panel).

For each record from Resend:
- **Type**: match exactly (MX / TXT)
- **Name/Host**: exactly as Resend shows (e.g. `send`, `resend._domainkey`)
- **Value/Content**: paste exactly (no extra spaces)
- **TTL**: default / 3600 is fine
- For the MX record, set **Priority** as Resend specifies (usually 10)

⚠️ Important: These new records do NOT touch or replace your existing email.
You are ADDING records. Your write@quiettruths.co.ke mailbox keeps working.

## Step 4 — Verify
- Back in Resend, click **Verify DNS Records**
- Propagation takes a few minutes to a few hours
- When every row shows **Verified** (green), you're done

## Step 5 — Tell me
Once it shows Verified, tell me. I'll deploy with:
- `RESEND_API_KEY` = (your key)
- `EMAIL_FROM`     = `Quietly Here <noreply@quiettruths.co.ke>`
- `APP_URL`        = `https://quietly-here.onrender.com`

## Free tier limits (plenty for launch)
- 3,000 emails / month, 100 / day
- Enough for confirmations for a friends-and-family test and beyond
