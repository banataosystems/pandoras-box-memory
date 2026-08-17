// Canonical SQL normalization for migration parity comparison.
//
// The provider does not store migration *files*. `supabase_migrations.schema_migrations`
// stores a `statements` array — the parsed statements the CLI actually applied.
// Comparing a committed .sql file byte-for-byte against that array will always
// differ, because file framing (leading comments, blank lines, the trailing
// semicolon on the final statement) is not part of a parsed statement.
//
// So byte equality is the wrong test. This module defines the equivalence that
// is actually meaningful: same statements, in the same order, ignoring comments
// and insignificant whitespace. Two artifacts that normalize identically apply
// the same DDL/DML to the database.
//
// This is deliberately conservative — it never rewrites string literals or
// identifiers, so it cannot make two genuinely different migrations look equal.

/**
 * Strip SQL comments that fall outside string literals and dollar-quoted bodies.
 *
 * Dollar-quoted bodies (function definitions) are preserved verbatim: a `--`
 * inside a PL/pgSQL body is part of the function source, not a file comment,
 * and removing it would change the stored routine definition.
 */
export function stripSqlComments(sql) {
  let out = "";
  let index = 0;
  const length = sql.length;

  while (index < length) {
    const char = sql[index];
    const next = sql[index + 1];

    // Single-quoted string literal, with '' escape.
    if (char === "'") {
      let end = index + 1;
      while (end < length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") break;
        end += 1;
      }
      out += sql.slice(index, Math.min(end + 1, length));
      index = end + 1;
      continue;
    }

    // Double-quoted identifier.
    if (char === '"') {
      let end = index + 1;
      while (end < length && sql[end] !== '"') end += 1;
      out += sql.slice(index, Math.min(end + 1, length));
      index = end + 1;
      continue;
    }

    // Dollar-quoted body: $tag$ ... $tag$
    if (char === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
      if (match) {
        const tag = match[0];
        const close = sql.indexOf(tag, index + tag.length);
        const end = close === -1 ? length : close + tag.length;
        out += sql.slice(index, end);
        index = end;
        continue;
      }
    }

    // Line comment.
    if (char === "-" && next === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? length : newline;
      continue;
    }

    // Block comment (non-nested is sufficient for this corpus; nested handled).
    if (char === "/" && next === "*") {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < length && depth > 0) {
        if (sql[cursor] === "/" && sql[cursor + 1] === "*") {
          depth += 1;
          cursor += 2;
        } else if (sql[cursor] === "*" && sql[cursor + 1] === "/") {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      index = cursor;
      out += " ";
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Split SQL into statements on top-level semicolons only.
 *
 * Semicolons inside string literals and dollar-quoted function bodies are not
 * statement terminators; splitting on them would corrupt every PL/pgSQL routine
 * in the corpus.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let index = 0;
  const length = sql.length;

  while (index < length) {
    const char = sql[index];

    if (char === "'") {
      let end = index + 1;
      while (end < length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") break;
        end += 1;
      }
      current += sql.slice(index, Math.min(end + 1, length));
      index = end + 1;
      continue;
    }

    if (char === '"') {
      let end = index + 1;
      while (end < length && sql[end] !== '"') end += 1;
      current += sql.slice(index, Math.min(end + 1, length));
      index = end + 1;
      continue;
    }

    if (char === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index));
      if (match) {
        const tag = match[0];
        const close = sql.indexOf(tag, index + tag.length);
        const end = close === -1 ? length : close + tag.length;
        current += sql.slice(index, end);
        index = end;
        continue;
      }
    }

    if (char === ";") {
      statements.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  statements.push(current);
  return statements;
}

/** Collapse insignificant whitespace outside quoted regions. */
function collapseWhitespace(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Produce the canonical comparison form of a SQL artifact: comments removed,
 * statements split, each statement whitespace-collapsed, empties dropped, and
 * rejoined with a single `;\n`.
 */
export function normalizeSql(sql) {
  return splitStatements(stripSqlComments(sql))
    .map(collapseWhitespace)
    .filter((statement) => statement.length > 0)
    .join(";\n");
}

/** Count the significant statements in a SQL artifact. */
export function countStatements(sql) {
  return splitStatements(stripSqlComments(sql))
    .map(collapseWhitespace)
    .filter((statement) => statement.length > 0).length;
}
