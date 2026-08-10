/**
 * 安全数学表达式求值器：递归下降解析。
 * 明确禁止 eval / new Function / Shell（设计文档 9.2）。
 * 仅支持：数值、+ - * / % **（或 ^）、括号、一元正负号。
 */

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "**" }
  | { kind: "lparen" }
  | { kind: "rparen" };

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

const MAX_EXPRESSION_LENGTH = 256;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const text = src.slice(i, j);
      const value = Number(text);
      if (text === "." || !Number.isFinite(value)) {
        throw new ExpressionError(`Invalid number: "${text}"`);
      }
      tokens.push({ kind: "num", value });
      i = j;
      continue;
    }
    if (ch === "*" && src[i + 1] === "*") {
      tokens.push({ kind: "op", op: "**" });
      i += 2;
      continue;
    }
    if (ch === "^") {
      tokens.push({ kind: "op", op: "**" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%") {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    throw new ExpressionError(`Unsupported character: "${ch}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr();
    if (this.pos !== this.tokens.length) {
      throw new ExpressionError("Unexpected trailing input");
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(): number {
    let left = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "+" || t.op === "-")) {
        this.pos++;
        const right = this.term();
        left = t.op === "+" ? left + right : left - right;
      } else {
        return left;
      }
    }
  }

  private term(): number {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "op" && (t.op === "*" || t.op === "/" || t.op === "%")) {
        this.pos++;
        const right = this.unary();
        if (t.op === "*") left *= right;
        else if (t.op === "/") {
          if (right === 0) throw new ExpressionError("Division by zero");
          left /= right;
        } else {
          if (right === 0) throw new ExpressionError("Modulo by zero");
          left %= right;
        }
      } else {
        return left;
      }
    }
  }

  private unary(): number {
    const t = this.peek();
    if (t?.kind === "op" && t.op === "-") {
      this.pos++;
      return -this.unary();
    }
    if (t?.kind === "op" && t.op === "+") {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.atom();
    const t = this.peek();
    if (t?.kind === "op" && t.op === "**") {
      this.pos++;
      // 右结合
      const exponent = this.unary();
      const value = Math.pow(base, exponent);
      if (!Number.isFinite(value)) throw new ExpressionError("Result out of range");
      return value;
    }
    return base;
  }

  private atom(): number {
    const t = this.peek();
    if (!t) throw new ExpressionError("Unexpected end of expression");
    if (t.kind === "num") {
      this.pos++;
      return t.value;
    }
    if (t.kind === "lparen") {
      this.pos++;
      const value = this.expr();
      const close = this.peek();
      if (close?.kind !== "rparen") throw new ExpressionError("Missing closing parenthesis");
      this.pos++;
      return value;
    }
    throw new ExpressionError("Expected a number or parenthesized expression");
  }
}

export function evaluateExpression(expression: string): number {
  if (expression.length === 0) throw new ExpressionError("Expression is empty");
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const value = new Parser(tokenize(expression)).parse();
  if (!Number.isFinite(value)) throw new ExpressionError("Result is not finite");
  return value;
}
