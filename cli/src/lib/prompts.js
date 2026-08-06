import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

export async function question(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("interactive input requires a terminal");
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await input.question(label)).trim();
  } finally {
    input.close();
  }
}

export async function passwordQuestion(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("interactive login requires a terminal; set CIDER_TOKEN for non-interactive use");
  }
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";
    const finish = (error) => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        finish(new Error("cancelled"));
      } else if (key?.name === "return" || key?.name === "enter") {
        finish();
      } else if (key?.name === "backspace") {
        password = password.slice(0, -1);
      } else if (character && !key?.ctrl && !key?.meta) {
        password += character;
      }
    };
    process.stdin.on("keypress", onKeypress);
  });
}

export async function confirm(label) {
  const answer = (await question(`${label} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}
