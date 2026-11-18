# Postfix

Outbound MTA. **Phase 9 only, and only after the sending gates pass.**

## Required configuration

- Submission (587) requires SASL auth and TLS; port 25 is for relay only.
- `smtpd_relay_restrictions = permit_sasl_authenticated, reject` — no open relay.
- `disable_vrfy_command = yes`, strict HELO, no backscatter.
- DKIM signing via OpenDKIM milter; header/body canonicalisation relaxed/simple.
- Bounce and complaint messages piped to `mail-ingestion`.

## DNS prerequisites (replace with real values)

```
mail.example.com.        A     YOUR_PUBLIC_IP
example.com.             MX 10 mail.example.com.
example.com.             TXT   "v=spf1 ip4:YOUR_PUBLIC_IP -all"
s1._domainkey.example.com. TXT "v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY"
_dmarc.example.com.      TXT   "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

Plus matching PTR, forward DNS, and a valid TLS certificate.

## Warning

Do not run production sending from a residential IP or a host without PTR control. Deliverability is not guaranteed by configuration.
