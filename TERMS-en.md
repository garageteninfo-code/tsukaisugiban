# Terms of use and privacy

Tsukaisugi-ban — a small gateway that stops AI overspending and over-sharing before requests are sent (free prototype).

This English text was translated with AI and has not been checked by a native speaker. If this English version and the Japanese version ([`利用条件.md`](利用条件.md)) differ, the Japanese version is the original.

## 1. What this tool does

You install and run this tool on your own PC or in-house server. It relays requests from your in-house tools to AI providers, enforces yen caps per person and per tool, redacts keys and apparent personal information before sending, and keeps a usage log and a monthly report.

## 2. Your AI API key and the AI provider's terms

- This tool uses **your own AI API key** (your own contract with the AI provider) **on your own PC or server**.
- **The provider (HARVEST) does not provide or resell AI API access.** HARVEST does not hold your API key and is not a party to your contract with the AI provider.
- AI usage fees are billed to you by the AI provider under your contract with them. Amounts shown by this tool are estimates.
- You must follow the AI provider's terms of service and usage policies. What information you may give to an AI provider is governed by your organisation's rules and that provider's terms. This tool does not replace that decision.
- You must enter the price of each AI model yourself, from the AI provider's official price list.

## 3. We do not collect or receive your data

- The tool sends nothing to the provider (HARVEST). API keys, request content, AI replies, usage, logs and settings travel only between the PC/server where you run it and the AI provider you contracted. The provider cannot see them.
- The log does not keep request content (only the kinds and counts of redacted items). You are responsible for managing, backing up and deleting logs and settings.
- Pass the company API key only via environment variables; do not write it to a file. You are responsible for keeping staff keys and the admin key safe.
- The source code is distributed via GitHub (a service of GitHub, Inc.). GitHub may keep connection records (such as IP addresses) of people who open its pages or download files, for security purposes. Please see GitHub's privacy statement. The provider does not view or use those records.

## 4. No guarantee

- This tool is a prototype. It has not yet been tested with a real AI API or with real Dify. Please try it on a test PC with low caps first.
- Amounts are estimates (price × exchange rate). The AI provider's invoice is authoritative. If actual usage exceeds the estimate, a cap may be slightly exceeded. Please also set spending limits in the AI provider's console.
- This tool does not find all personal information or secrets. In particular, it is known to miss personal names. Redaction may also make AI answers worse.
- This tool is not a certification, accreditation or guarantee.
- The tool is provided "as is", free of charge.
- If the provider is liable for any damage you suffer (including AI usage fees) from using, or being unable to use, this tool, the provider's total liability is limited to JPY 10,000.
- This cap applies only to damage caused by the provider's ordinary (slight) negligence. It does not apply to damage caused by the provider's willful misconduct or gross negligence.
- Nothing in these terms limits any rights you have under mandatory consumer-protection laws of your country or region.
- Whether your use meets the rules of your clients or parent company is for you and them to decide.
- The tool does not give legal advice or make legal judgements (for example, about what privacy laws allow).

## 5. Permitted use

You may view the source code and use the tool within yourself or your own company free of charge, including for work. Copying and distributing, selling, distributing modified versions or incorporating it into other products requires prior written permission. See [`LICENSE`](LICENSE).

## 6. Provider

HARVEST (Japan) / Contact: garageten.info@gmail.com (this address dates from our former name, GARAGE TEN)

This tool is free.

## 7. Changes

We may change these terms. When we do, we will note the date in this document. Last updated: 15 November 2026
