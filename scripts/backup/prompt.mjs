// Asks for a secret on the terminal WITHOUT echoing it, so it never lands in shell history, a screen recording or a process listing.
// Used only when the value is not already in the environment and a person is at the keyboard (a TTY). Nothing is stored or printed.
import { createInterface } from "node:readline";

export function promptHidden(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error(`${label} was not provided (and there is no terminal to ask on)`));
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const write = rl._writeToOutput;
    let muted = false;
    rl._writeToOutput = (s) => (muted ? undefined : write.call(rl, s));
    process.stderr.write(`${label}: `);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      process.stderr.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

/** The value from the environment if set, otherwise asked for (hidden). */
export async function secret(envName, label) {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  return promptHidden(label);
}
