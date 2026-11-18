# OpenDKIM

DKIM signing keys and milter configuration.

- 2048-bit keys, one selector per sending domain (`s1`, rotate to `s2`).
- Private key mounted read-only, mode 0600, owned by the opendkim user; never in git or an image.
- Key rotation: publish new selector → sign with it → wait ≥ 2 key TTLs → retire old.
- Verify alignment against DMARC before enabling production sending.
