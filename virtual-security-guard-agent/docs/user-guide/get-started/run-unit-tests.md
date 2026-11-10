<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Run Unit Tests

The UI is tested with [Vitest](https://vitest.dev/). You need GNU Make and
Node.js 22. From the `virtual-security-guard-agent` application directory:

```bash
make install        # once: npm ci
make check          # lint + type-check + unit tests
make lint           # lint + type-check only
make test           # unit tests only
make format         # format the sources with Prettier
```
