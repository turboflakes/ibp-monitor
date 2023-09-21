'use strict'

import dns from 'node:dns'
import edns from 'evil-dns'

// eDns has patched node:dns and not node:dns/promises
export const lookupAsync = async (domain) => {
  return new Promise((resolve, reject) => {
    dns.lookup(domain, (err, address, family) => {
      if (err) reject(err)
      resolve({ address, family })
    })
  })
}

export const setDNS = async (domain, ip) => {
  edns.add(domain, ip)
  var { address } = await lookupAsync(domain)
  console.debug(`${domain} now resolves to ${address}, and should be ${ip}`)
}

export const clearDNS = async (domain, ip) => {
  console.log(`removing eDns for ${domain}`)
  edns.remove(domain, ip)
  var { address } = await lookupAsync(domain)
  console.log(`${domain} now resolves to ${address}\n`)
}

export const getDomain = (subdomain = 'rpc') => `${subdomain}.dotters.network`
export const getEndpoint = (subdomain = 'rpc', chain = 'polkadot') => `wss://${getDomain(subdomain)}/${chain}`