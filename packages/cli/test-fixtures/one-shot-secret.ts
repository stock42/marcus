import { MarcusCli, type CliRequester } from "../src/index";

const requester: CliRequester = {
  async connect() {},
  close() {},
  async request() { return { ok: true } as never; },
};

const cli = new MarcusCli(requester, { terminal: true });
process.stdout.write(`${JSON.stringify(await cli.execute("bootstrap setup --username admin"))}\n`);
