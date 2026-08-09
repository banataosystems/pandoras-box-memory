# Vercel Rebind Probe

Purpose: verify that the Vercel `memory` project is bound to `banataosystems/pandoras-box-memory` after migration away from the unavailable legacy repository.

This file is deployment-neutral: it changes no application behavior, schema, secrets, authentication logic, or canonical Memory data.

Expected result: merging this change to `main` should trigger a new Vercel deployment from this repository if the Git binding is healthy.
