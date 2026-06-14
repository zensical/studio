/*
 * Copyright (c) 2026 Zensical and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

import type { Context } from "../context";
import { fetchToken } from "./fetch";

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Get token from cache or fetch a new one if not available.
 *
 * @param context - Context
 *
 * @returns Token or nothing
 */
export async function getToken(context: Context): Promise<string | undefined> {
  const prior = context.getState("token");

  // Always try to fetch a new token, even if we have a prior one, to ensure
  // Zensical Studio works for up to 7 days without interruption.
  const { token } = (await fetchToken(context, prior)) ?? {};
  if (typeof token === "undefined") {
    return prior;
  } else {
    context.setState("token", token);
    return token;
  }
}
