import { Queue } from 'bullmq'
import { Op } from 'sequelize'
import { config } from '../config/config.js'
import { config as configLocal } from '../config/config.local.js'

const cfg = Object.assign(config, configLocal)

const jobRetention = {
  timeout: 60 * 1000, // active jobs timeout after 60 seconds
  removeOnComplete: {
    age: 5 * 24 * 60 * 60, // keep up to 5 * 24 hour (in millis)
    count: 10000, // keep up to 1000 jobs
  },
  removeOnFail: {
    age: 5 * 24 * 60 * 60, // keep up to 5 * 24 hours (in millis)
  },
}

// ALERT CODES

// ALERT_CODE_100: service is down
const ALERT_CODE_100 = 100
// ALERT_CODE_101: verify if chain hasn't stalled by checking previous blockHeader with the latest received
const ALERT_CODE_101 = 101
// ALERT_CODE_102: verify if blockDrift is higher than the threshold defined in config
const ALERT_CODE_102 = 102
// ALERT_CODE_103: verify if performance if above threshold defined (500ms)
const ALERT_CODE_103 = 103

// SEVERITY LEVELS
const SEVERITY_HIGH = "high"
const SEVERITY_MEDIUM = "medium"
const SEVERITY_LOW = "low"

export class AlertsEngine {
  queue = undefined
  datastore = undefined
  constructor({ datastore }) {
    const queue = new Queue(cfg.alertsEngine.queueName, { connection: cfg.redis })
    this.queue = queue
    this.datastore = datastore
  }

  // evaluate alert rules and publish alerts into specific queue to be processed later
  async run(currentHealthCheck) {
    // if alerts are not enabled for the current monitor just skip
    if (!cfg.alertsEngine.enabled) {
      return 
    }
    
    // query for a previous healthCheck from member and service that was created more than 60 seconds ago
    const previousHealthCheck = await this.datastore.HealthCheck.findOne({
      where: { 
        memberId: currentHealthCheck.memberId, 
        serviceId: currentHealthCheck.serviceId,
        status: "success",
        createdAt: {
          [Op.lt]: new Date(new Date() - 60 * 1000)
        }
        // createdAt < [timestamp]
      },
      order: [['createdAt', 'DESC']],
    })

    // query for a previous healthCheck from the same service but different member that was created within the last 10 minutes
    const otherMemberHealthCheck = await this.datastore.HealthCheck.findOne({
      where: { 
        memberId: {
          [Op.ne]: currentHealthCheck.memberId,
        },
        serviceId: currentHealthCheck.serviceId,
        status: "success",
        createdAt: {
          [Op.lt]: new Date(new Date() - 60 * 1000),
          [Op.gt]: new Date(new Date() - 10 * 60 * 1000)
        }
        // createdAt < [timestamp]
      },
      order: [['createdAt', 'DESC']],
    })

    // ALERT_CODE_100
    if (currentHealthCheck.status === 'error') {
      console.debug('Creating new [alert] job for', currentHealthCheck.memberId, currentHealthCheck.serviceId)
      const message = !!currentHealthCheck.record ? (!!currentHealthCheck.record.error ? `${currentHealthCheck.record.error.message}` : `Error message not available`) : `Error message not available`
      this.queue.add(
        cfg.alertsEngine.queueName,
        {
          code: ALERT_CODE_100,
          severity: SEVERITY_HIGH,
          message: message,
          memberId: currentHealthCheck.memberId,
          serviceId: currentHealthCheck.serviceId,
          healthCheckId: currentHealthCheck.id,
          healthChecks: [currentHealthCheck],
        },
        { repeat: false, ...jobRetention }
      )
    }

    // ALERT_CODE_101
    if (currentHealthCheck.status !== null && previousHealthCheck !== null && otherMemberHealthCheck !== null) {
      if (previousHealthCheck.status === 'success' && currentHealthCheck.status === 'success' && otherMemberHealthCheck.status === 'success') {
        if (previousHealthCheck.record.syncState !== undefined && currentHealthCheck.record.syncState !== undefined && otherMemberHealthCheck.record.syncState !== undefined) {
          if (previousHealthCheck.record.syncState.currentBlock === currentHealthCheck.record.syncState.currentBlock && otherMemberHealthCheck.record.syncState.currentBlock !== currentHealthCheck.record.syncState.currentBlock) {
            console.debug('Creating new [alert] job for', currentHealthCheck.memberId, currentHealthCheck.serviceId)
            this.queue.add(
              cfg.alertsEngine.queueName,
              {
                code: ALERT_CODE_101,
                severity: SEVERITY_HIGH,
                message: `Best block is halted at block #${currentHealthCheck.record.syncState.currentBlock} since the last Health Check #${previousHealthCheck.id}`,
                memberId: currentHealthCheck.memberId,
                serviceId: currentHealthCheck.serviceId,
                healthCheckId: currentHealthCheck.id,
                healthChecks: [currentHealthCheck, previousHealthCheck],
              },
              { repeat: false, ...jobRetention }
            )
          }
        }
      }
    }

    // ALERT_CODE_102
    if (currentHealthCheck.status === 'success') {
      if (currentHealthCheck.record.syncState !== undefined) {
        const blockDrift = currentHealthCheck.record.syncState.currentBlock - currentHealthCheck.record.finalizedBlock
        if (blockDrift >= cfg.alertsEngine.thresholds.blockDrift) {
          console.debug('Creating new [alert] job for', currentHealthCheck.memberId, currentHealthCheck.serviceId)
          this.queue.add(
            cfg.alertsEngine.queueName,
            {
              code: ALERT_CODE_102,
              severity: SEVERITY_MEDIUM,
              message: `Finalized block #${currentHealthCheck.record.finalizedBlock} drifting by more than ${blockDrift} blocks`,
              memberId: currentHealthCheck.memberId,
              serviceId: currentHealthCheck.serviceId,
              healthCheckId: currentHealthCheck.id,
              healthChecks: [currentHealthCheck],
            },
            { repeat: false, ...jobRetention }
          )
        }
      }
    }

    // ALERT_CODE_103
    if (currentHealthCheck.status === 'success') {
      if (currentHealthCheck.record.performance > cfg.performance.sla) {
        console.debug('Creating new [alert] job for', currentHealthCheck.memberId, currentHealthCheck.serviceId)
        this.queue.add(
          cfg.alertsEngine.queueName,
          {
            code: ALERT_CODE_103,
            severity: SEVERITY_LOW,
            message: `Service response time ${currentHealthCheck.record.performance}ms is higher than expected`,
            memberId: currentHealthCheck.memberId,
            serviceId: currentHealthCheck.serviceId,
            healthCheckId: currentHealthCheck.id,
            healthChecks: [currentHealthCheck],
          },
          { repeat: false, ...jobRetention }
        )
      }
    }
  }
}