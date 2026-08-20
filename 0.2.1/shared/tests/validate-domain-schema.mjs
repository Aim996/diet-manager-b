import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..", "..");
const schemaPath = path.join(projectRoot, "shared", "schemas", "domain.schema.json");
const casesPath = path.join(projectRoot, "shared", "schemas", "fixtures", "domain-cases.json");

function printResult(name, value) {
  process.stdout.write(`${name}=${value}\n`);
}

function failBeforeCompile(code, detail, caseCount = 0) {
  printResult("SCHEMA_COMPILE", "NOT_RUN");
  printResult("CASE_TOTAL", caseCount);
  printResult("VALID_PASS", "0/0");
  printResult("INVALID_PASS", "0/0");
  printResult("CASE_FAILURE_COUNT", 0);
  printResult("ERROR_CODE", code);
  printResult("ERROR_DETAIL", detail);
  printResult("RUNNER_VERDICT", "FAIL");
  process.exitCode = 2;
}

if (!fs.existsSync(casesPath)) {
  failBeforeCompile("FIXTURES_NOT_FOUND", casesPath);
} else {
  let fixtureDocument;
  try {
    fixtureDocument = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  } catch (error) {
    failBeforeCompile("FIXTURES_INVALID_JSON", error.message);
  }

  if (fixtureDocument !== undefined) {
    const hasCaseArray = Array.isArray(fixtureDocument?.cases);
    const cases = hasCaseArray ? fixtureDocument.cases : [];
    if (!hasCaseArray || cases.length === 0) {
      failBeforeCompile(
        "FIXTURES_INVALID_SHAPE",
        hasCaseArray ? "cases must contain at least one case" : "cases must be an array",
        cases.length
      );
    } else if (!fs.existsSync(schemaPath)) {
      failBeforeCompile("SCHEMA_NOT_FOUND", schemaPath, cases.length);
    } else {
      const ajvEntry = process.env.DIET_MANAGER_AJV_2020;
      const ajvFormatsEntry = process.env.DIET_MANAGER_AJV_FORMATS;
      if (!ajvEntry || !fs.existsSync(ajvEntry)) {
        failBeforeCompile("AJV_2020_NOT_FOUND", ajvEntry || "DIET_MANAGER_AJV_2020 is unset", cases.length);
      } else if (!ajvFormatsEntry || !fs.existsSync(ajvFormatsEntry)) {
        failBeforeCompile("AJV_FORMATS_NOT_FOUND", ajvFormatsEntry || "DIET_MANAGER_AJV_FORMATS is unset", cases.length);
      } else {
        try {
          const AjvModule = require(ajvEntry);
          const Ajv2020 = AjvModule.default ?? AjvModule;
          const AjvFormatsModule = require(ajvFormatsEntry);
          const addFormats = AjvFormatsModule.default ?? AjvFormatsModule;
          const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
          const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
          addFormats(ajv, { mode: "full" });
          ajv.addSchema(schema, schema.$id);
          const rootValidate = ajv.getSchema(schema.$id);
          if (!rootValidate) {
            throw new Error(`Root schema was not registered: ${schema.$id}`);
          }
          const validatorByRef = new Map();

          function validatorFor(testCase) {
            if (!testCase.schema_ref) {
              return rootValidate;
            }
            if (!testCase.schema_ref.startsWith("#/$defs/")) {
              throw new Error(`Unsupported schema_ref for ${testCase.id}: ${testCase.schema_ref}`);
            }
            if (!validatorByRef.has(testCase.schema_ref)) {
              validatorByRef.set(
                testCase.schema_ref,
                ajv.compile({ $ref: `${schema.$id}${testCase.schema_ref}` })
              );
            }
            return validatorByRef.get(testCase.schema_ref);
          }

          let validTotal = 0;
          let validPass = 0;
          let invalidTotal = 0;
          let invalidPass = 0;
          const failures = [];

          for (const testCase of cases) {
            const targetValidate = validatorFor(testCase);
            const targetActual = targetValidate(testCase.model);
            const targetErrors = targetValidate.errors ? structuredClone(targetValidate.errors) : [];
            const targetKeywords = [...new Set(targetErrors.map((error) => error.keyword))];
            const rootActual = rootValidate(testCase.model);
            const rootErrors = rootValidate.errors ? structuredClone(rootValidate.errors) : [];
            const expectedRoot = testCase.root_valid ?? testCase.valid;

            if (testCase.valid === true) {
              validTotal += 1;
              if (targetActual === true && rootActual === expectedRoot) {
                validPass += 1;
              } else {
                failures.push(`${testCase.id}|schema_ref=${testCase.schema_ref || "root"}|expected=target-valid,root-${expectedRoot}|target=${targetActual}|root=${rootActual}|target_keywords=${targetKeywords.join(",")}|target_errors=${JSON.stringify(targetErrors)}|root_errors=${JSON.stringify(rootErrors)}`);
              }
              continue;
            }

            invalidTotal += 1;
            const matchingError = targetErrors.find((error) =>
              error.keyword === testCase.expected_keyword &&
              (!testCase.expected_schema_path || error.schemaPath.endsWith(testCase.expected_schema_path)) &&
              (testCase.expected_instance_path === undefined || error.instancePath === testCase.expected_instance_path) &&
              Object.entries(testCase.expected_params ?? {}).every(
                ([name, value]) => JSON.stringify(error.params?.[name]) === JSON.stringify(value)
              )
            );
            if (targetActual === false && matchingError && rootActual === false) {
              invalidPass += 1;
            } else {
              failures.push(`${testCase.id}|schema_ref=${testCase.schema_ref || "root"}|expected=target-invalid:${testCase.expected_keyword}:${testCase.expected_schema_path || "any-path"}:${testCase.expected_instance_path ?? "any-instance"}:params=${JSON.stringify(testCase.expected_params ?? {})},root-invalid|target=${targetActual}|root=${rootActual}|target_keywords=${targetKeywords.join(",")}|target_errors=${JSON.stringify(targetErrors)}|root_errors=${JSON.stringify(rootErrors)}`);
            }
          }

          printResult("SCHEMA_COMPILE", "PASS");
          printResult("CASE_TOTAL", cases.length);
          printResult("VALID_PASS", `${validPass}/${validTotal}`);
          printResult("INVALID_PASS", `${invalidPass}/${invalidTotal}`);
          printResult("CASE_FAILURE_COUNT", failures.length);
          for (const failure of failures) {
            printResult("CASE_FAIL", failure);
          }
          printResult("RUNNER_VERDICT", failures.length === 0 ? "PASS" : "FAIL");
          process.exitCode = failures.length === 0 ? 0 : 1;
        } catch (error) {
          printResult("SCHEMA_COMPILE", "FAIL");
          printResult("CASE_TOTAL", cases.length);
          printResult("VALID_PASS", "0/0");
          printResult("INVALID_PASS", "0/0");
          printResult("CASE_FAILURE_COUNT", 0);
          printResult("ERROR_CODE", "SCHEMA_OR_RUNTIME_ERROR");
          printResult("ERROR_DETAIL", error.stack || error.message);
          printResult("RUNNER_VERDICT", "FAIL");
          process.exitCode = 2;
        }
      }
    }
  }
}
