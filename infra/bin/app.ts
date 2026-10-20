import { App, Tags } from "aws-cdk-lib";
import { AppStack, CertStack, CiStack } from "../lib/stacks";

const account = "334772842524";
const app = new App();
Tags.of(app).add("app", "aubi-honey");

const cert = new CertStack(app, "AubiHoneyCert", { env: { account, region: "us-east-1" }, crossRegionReferences: true });
new AppStack(app, "AubiHoney", {
  env: { account, region: "us-west-1" },
  crossRegionReferences: true,
  certificate: cert.certificate,
});
new CiStack(app, "AubiHoneyCi", { env: { account, region: "us-west-1" } });
