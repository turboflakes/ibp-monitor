import { DataStore } from './DataStore.js'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { HealthChecker } from './HealthChecker.js'

class MessageHandler {

  datastore = undefined //= new DataStore({ initialiseDb: true })
  api = undefined

  constructor(config) {
    // console.log('MessageHandler()', config)
    this.datastore = config?.datastore || new DataStore({ initialiseDb: true })
    this.api = config.api || new HealthChecker()
    // this.datastore = new DataStore({ initialiseDb: true })
    // console.log('MessageHandler()', this.datastore)
  }

  // libp2p.addEventListener('peer:discovery', (peerId) => {})
  async handleDiscovery (peerId) {
    console.debug('peer:discover ', peerId.detail.id.toString())
    try {
      const model = { monitorId: peerId.detail.id.toString() }
      const [monitorModel, created] = await this.datastore.Monitor.upsert(model, model)
    } catch (err) {
      console.warn('Error trying to upsert discovered monitor', peerId.detail.id.toString())
      console.error(err)
    }
    // console.debug('upsert', created, peerModel)
  }

  /**
   * event: {
   *  signed:
   *  from: Ed25519PeerId
   *  data: Uint8Array(246)
   *  sequenceNumber: number (BigInt?)
   *  topic: string
   *  signature: Uint8Array(64)
   *  key: Uint8Array(32)
   * }
   * @param {} evt 
   */
  async handleMessage (evt) {
    // console.log(evt.detail)
    // if (peerId != self.peerId) {}
    var model
    switch (evt.detail.topic) {

      // a peer has published their services
      case '/ibp/services':
        const services = JSON.parse(uint8ArrayToString(evt.detail.data)) || []
        console.debug('/ibp/services from', evt.detail.from.toString()) //, services)
        // `touch` the peer model
        let [monitor, _] = await this.datastore.Monitor.upsert({
          monitorId: evt.detail.from.toString(),
          services: services
        })
        // var ids = []
        for (var i = 0; i < services.length; i++) {
          model = services[i]
          console.log(model)
          const [x, _] = await this.datastore.Service.upsert(model)
          await this.datastore.Peer.upsert({peerId: evt.detail.from.toString(), serviceUrl: model.serviceUrl})
          // ids.push(model.url)
        }
        // await monitor.addServices(ids)
        break

      // a peer has published some results
      case '/ibp/healthCheck':
        const record = JSON.parse(uint8ArrayToString(evt.detail.data))
        model = {
          monitorId: evt.detail.from.toString(),
          serviceUrl: record.serviceUrl,
          level: record.level || 'info',
          source: 'gossip',
          record
        }
        console.log('/ibp/healthCheck from', evt.detail.from.toString(), 'for', record.serviceUrl)
        // console.log('handleMessage: /ibp/healthCheck', model)
        // await this.datastore.insertHealthCheck(evt.detail.from.toString(), model)
        await this.datastore.HealthCheck.create(model)
        break

      default:
        console.log(`received: ${uint8ArrayToString(evt.detail.data)} from ${evt.detail.from.toString()} on topic ${evt.detail.topic}`)
    }
  }

  // publish services we have
  async publishServices (services = [], libp2p) {
    for (var i = 0; i < services.length; i++) {
      const service = services[i]
      // try {
      //   service.serviceId = await this.api.getServiceId(service.url)
      // } catch (err) {
      //   console.warn('Error getting serviceId for', service.url)
      //   console.error(err)
      // }
      // console.debug('result', results[0])
      const res = await libp2p.pubsub.publish('/ibp/services', uint8ArrayFromString(JSON.stringify([service])))
      // console.debug(res)
    }
  }

  // publish the results of our healthChecks
  async publishResults (results = []) {
    console.debug('Publishing our healthChecks')
    libp2p.getPeers().forEach(async (peerId) => {
      console.log('our peers are:', peerId.toString())
      const peer = await ds.Peer.findByPk( peerId.toString(), { include: 'services' })
      // console.debug('peer', peer)
      const results = await hc.check(peer.services) || []
      console.debug(`publishing healthCheck: ${results.length} results to /ibp/healthCheck`)
      asyncForeach(results, async (result) => {
        const res = await libp2p.pubsub.publish('/ibp/healthCheck', uint8ArrayFromString(JSON.stringify(result)))
        // console.debug('sent message to peer', res?.toString())
      })
    }) // === end of peers update cycle ===

    // check our own services?
    if (config.checkOwnServices) {
      console.debug('checking our own services...')
      const results = await hc.check(config.services) || []
      console.debug(`publishing healthCheck: ${results.length} results to /ibp/healthCheck`)
      asyncForeach(results, async (result) => {
        const res = await libp2p.pubsub.publish('/ibp/healthCheck', uint8ArrayFromString(JSON.stringify(result)))
      })
    }
  } // end of publishResults()

}

export {
  MessageHandler
}
