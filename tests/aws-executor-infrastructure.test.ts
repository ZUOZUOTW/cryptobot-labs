import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AWS executor edge isolation", () => {
  it("allows HTTPS only from Cloudflare proxy ranges", async () => {
    const [main, variables] = await Promise.all([
      readFile("infra/aws-executor/main.tf", "utf8"),
      readFile("infra/aws-executor/variables.tf", "utf8"),
    ]);

    const ingress = main.match(
      /resource "aws_vpc_security_group_ingress_rule" "https_cloudflare" \{[\s\S]*?\n\}/,
    )?.[0];
    expect(ingress).toBeDefined();
    expect(ingress).toContain("var.cloudflare_ipv4_cidrs");
    expect(ingress).toContain("cidr_ipv4         = each.value");
    expect(ingress).not.toContain("0.0.0.0/0");
    expect(variables).toContain('description = "Cloudflare HTTP proxy IPv4 ranges');
    expect(variables).toContain('"173.245.48.0/20"');
    expect(variables).toContain('"131.0.72.0/22"');
  });

  it("never creates a DNS-only API record", async () => {
    const main = await readFile("infra/aws-executor/main.tf", "utf8");
    const record = main.match(/resource "cloudflare_dns_record" "api" \{[\s\S]*?\n\}/)?.[0];

    expect(record).toBeDefined();
    expect(record).toContain("ttl     = 1");
    expect(record).toContain("proxied = true");
    expect(record).not.toContain("proxied = false");
  });

  it("cannot replace the production executor during a routine apply", async () => {
    const main = await readFile("infra/aws-executor/main.tf", "utf8");
    const executor = main.match(
      /resource "aws_instance" "executor" \{[\s\S]*?lifecycle \{[\s\S]*?ignore_changes\s+= \[ami\][\s\S]*?\n\s*\}/,
    )?.[0];

    expect(executor).toBeDefined();
    expect(executor).toContain("prevent_destroy = true");
    expect(executor).toContain("ignore_changes  = [ami]");
  });
});
