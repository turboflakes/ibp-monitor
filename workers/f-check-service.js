'use strict'

import dns from 'node:dns'
import edns from 'evil-dns'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { serializeError } from 'serialize-error'

import { config } from '../config/config.js'
import { config as configLocal } from '../config/config.local.js'
const cfg = Object.assign(config, configLocal)

// eDns has patched node:dns and not node:dns/promises
async function lookupAsync(domain) {
  return new Promise((resolve, reject) => {
    dns.lookup(domain, (err, address, family) => {
      if (err) reject(err)
      resolve({ address, family })
    })
  })
}

const setDNS = async (domain, ip) => {
  edns.add(domain, ip)
  var { address } = await lookupAsync(domain)
  console.debug(`${domain} now resolves to ${address}, and should be ${ip}`)
}
const clearDNS = async (domain, ip) => {
  console.log(`removing eDns for ${domain}`)
  edns.remove(domain, ip)
  var { address } = await lookupAsync(domain)
  console.log(`${domain} now resolves to ${address}\n`)
}

class TimeoutException extends Error {
  constructor(message) {
    super(message)
    this.name = 'TimeoutException'
  }
}

const getDomain = (subdomain = 'rpc') => `${subdomain}.dotters.network`
const getEndpoint = (subdomain = 'rpc', chain = 'polkadot') => `wss://${getDomain(subdomain)}/${chain}`

const performCheck = async (job) => {
  const { subdomain, member, service, monitorId } = job.data
  console.debug('[worker] checkService', subdomain, member.id, service.id)

  const endpoint = getEndpoint(subdomain, service.chainId)

  job.log(`checkService: ${endpoint}, ${member.id}, ${service.id}`)

  const provider = new WsProvider(endpoint, false, {}, 10 * 1000) // 10 seconds timeout
  // any error is 'out of context' in the handler and does not stop the `await provider.isReady`
  // provider.on('connected | disconnected | error')
  job.log('connecting to provider...')
  // https://github.com/polkadot-js/api/issues/5249#issue-1392411072
  await new Promise((resolve, reject) => {
    provider.on('error', async (err) => {
      job.log('== got providerError for ', service.serviceUrl)
      job.log(err.toString())
      reject(err)
    })
    provider.on('connected', () => {
      resolve()
    })
    provider.connect()
  })
  job.log('waiting for provider to be ready...')
  await provider.isReady
  
  job.log('provider is ready, connecting to api...')
  const api = await ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true })
  // api.on('error', function (err) { throw new ApiError(err.toString()) })
  api.on('error', async (err) => {
    job.log('== got apiError for ', service.serviceUrl)
    job.log(err)
    console.log('== got apiError for ', service.serviceUrl)
    console.log(err)
    // result = handleProviderError(err, service, peerId)
    await provider.disconnect()
    // throw new Error(err)
  })
  job.log('waiting for api to be ready...')
  await api.isReady
  job.log('api is ready, getting stats from provider / api...')

  const peerId = await api.rpc.system.localPeerId()
  const chain = await api.rpc.system.chain()
  const chainType = await api.rpc.system.chainType()

  // start
  const start = performance.now()
  const health = await api.rpc.system.health()
  const end = performance.now()
  // end timer

  const networkState = api.rpc.system.networkState // () // not a function?
  const syncState = await api.rpc.system.syncState()
  const finalizedBlockHash = await api.rpc.chain.getFinalizedHead()
  const { number: finalizedBlock } = await api.rpc.chain.getHeader(finalizedBlockHash)
  const version = await api.rpc.system.version()

  // check if node is archive by querying a random block 
  const randBlockNumber =  Math.floor(Math.random() * (finalizedBlock / 2)) + 1;
  const block_hash = await api.rpc.chain.getBlockHash(randBlockNumber)
  const runtimeVersion = await api.rpc.state.getRuntimeVersion(block_hash)
  
  // clean up before return
  await api.disconnect()
  await provider.disconnect()
  
  // prepare data
  const archiveState = {
    randomBlock: randBlockNumber,
    specVersion: runtimeVersion.specVersion.toString()
  }
  const timing = end - start

  return {
    // our peerId will be added by the receiver of the /ibp/healthCheck messate
    monitorId,
    serviceId: service.id,
    memberId: member.id,
    peerId: peerId.toString(),
    source: 'check',
    type: 'service_check',
    status: timing > (cfg.performance?.sla || 500) ? 'warning' : 'success',
    responseTimeMs: timing,
    record: {
      monitorId,
      memberId: member.id,
      serviceId: service.id,
      endpoint,
      ipAddress: member.serviceIpAddress,
      chain,
      chainType,
      health,
      networkState,
      syncState,
      finalizedBlock,
      archiveState,
      version,
      // peerCount,
      performance: timing,
    },
  }
}

const performCheckError = (error, job) => {
  const { name, message } = error
  const { subdomain, member, service, monitorId } = job.data
  return {
    // our peerId will be added by the receiver of the /ibp/healthCheck message
    monitorId,
    serviceId: service.id,
    memberId: member.id,
    peerId: null,
    source: 'check',
    type: 'service_check',
    status: 'error',
    record: {
      monitorId,
      memberId: member.id,
      serviceId: service.id,
      endpoint: getEndpoint(subdomain, service.chainId),
      ip_address: member.serviceIpAddress,
      error: serializeError({name, message}),
      performance: -1,
    }
  }
}

const retryFn = async (fn, job, retriesLeft = 3, interval = 1000) => {
  job.log(`retryAttempt ${retriesLeft}`)
  try {
    return await fn(job)
  } catch (error) {
    job.log(error)
    console.log(error)
    // If error type is RpcError raise alert no need to retry, something needs to be fixed 
    if (error.name === "RpcError") {
      return performCheckError(error, job)
    } else if (retriesLeft) {
      // Wait interval milliseconds before next try
      await new Promise(resolve => setTimeout(resolve, interval));
      return retryFn(fn, job, retriesLeft - 1, interval);
    } else {
      return performCheckError(error, job)
    }
  }
}

/**
 * Similar to healthCheck-endpoint, but for IBP url at member.services_address
 * @param {} job
 * @returns
 */
export const checkService = async (job) => {
  // console.log('job.data', job.data);

  const { subdomain, member, service } = job.data;
  
  // amend DNS
  await setDNS(getDomain(subdomain), member.serviceIpAddress);

  // retry check 3 times, wait 5 seconds between each try
  const result = await retryFn(performCheck, job, 3, 1 * 1000);

  // clear DNS
  await clearDNS(getDomain(subdomain), member.serviceIpAddress);

  console.log('[worker] checkService done...', member.id, service.id);
  job.log('checkService done...', member.id, service.id);
  return result

}