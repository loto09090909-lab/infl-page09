export async function locked(env: any, ip: string) {
  const lockKey = `lock:${ip}`;
  const lockStatus = await env.PAGE_KV.get(lockKey);

  if (lockStatus) {
    return true;
  }

  return false;
}

export async function fail(env: any, ip: string) {
  const failKey = `fail:${ip}`;
  let failCount = await env.PAGE_KV.get(failKey);

  if (failCount) {
    failCount = parseInt(failCount, 10);
  } else {
    failCount = 0;
  }

  failCount += 1;

  if (failCount >= 5) {
    await env.PAGE_KV.put(`lock:${ip}`, "locked");
  }

  await env.PAGE_KV.put(failKey, failCount.toString());
  return failCount;
}

export async function clear(env: any, ip: string) {
  await env.PAGE_KV.delete(`lock:${ip}`);
  await env.PAGE_KV.delete(`fail:${ip}`);
}
