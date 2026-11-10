# Demo walkthrough

1. Run `npm ci`, `npm run build`, and `npm run demo`. The preview seeds examples once and stays in mock mode.
2. Open the MIPS guide. Expand source notes, read concepts, try each question, then reveal its answer.
3. Select New guide → Explain a topic. Enter “Conditional probability” with subject Mathematics and leave context empty. Submit; watch saved status become completed.
4. Select New guide → Paste notes and use a sample. Verify the notes are preserved in the resulting guide.
5. Filter by subject or status and search by title/context. Clear filters to return to the complete library.
6. In the new-guide dialog, choose temporary failure. Watch retrying become completed and inspect both history entries. Permanent failure retains a failure code and history.
7. With real PostgreSQL/RabbitMQ running, use `npm run test:integration` for duplicate-delivery, retry/dead-letter, publisher-disconnect and worker-crash checks.

For a synthetic infrastructure workload, start a mock server and run `npm run benchmark -- --provider=mock --guides=100 --concurrency=10`. Reports identify whether transport is preview or RabbitMQ. Do not describe preview measurements as RabbitMQ scaling results.
