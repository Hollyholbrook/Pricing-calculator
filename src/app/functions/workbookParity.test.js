const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { calculateQuote } = require('./calculator');

const parity = require(path.resolve(__dirname, 'fixtures/workbook_parity_v2.json'));

for (const scenario of parity.scenarios) {
  test(`workbook parity: ${scenario.name}`, () => {
    const result = calculateQuote(scenario.input);
    const line = result.lines.find(
      ({ productKey }) => productKey === scenario.expected.productKey,
    );

    assert.ok(line, `Missing ${scenario.expected.productKey}`);
    assert.equal(line.proposedUnitRate, scenario.expected.proposedUnitRate);
    assert.equal(line.proposedMrr, scenario.expected.proposedMrr);
    assert.equal(line.annualCommitment, scenario.expected.annualCommitment);
    if (scenario.expected.proposedBandRates) {
      assert.deepEqual(
        line.proposedBandRates.map(({ rate }) => rate),
        scenario.expected.proposedBandRates,
      );
    }
  });
}
