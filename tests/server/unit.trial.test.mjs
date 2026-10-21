import test from 'node:test';
import assert from 'node:assert/strict';
import { trialStatus, trialRequest } from '../../api/_lib/trial.js';
test('trial onboarding is fail-closed when services are unconfigured', async () => {
  const response=trialStatus();
  assert.equal(response.status,200);
  const status=await response.json();
  assert.equal(status.days,7);
  assert.equal(status.paymentRequired,false);
  assert.equal(status.available,false);
});
test('no database or system mail cannot create a trial', async () => {
  const response=await trialRequest(new Request('https://erp.vyntexusa.com/api/auth/trial/request',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'trial_not_ready');
});

