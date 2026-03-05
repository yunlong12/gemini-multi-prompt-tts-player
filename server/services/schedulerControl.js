import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { logError, logInfo } from '../utils/logger.js';

const schedulerLocation = process.env.CLOUD_SCHEDULER_LOCATION || process.env.REGION || 'us-central1';
const schedulerJobName = process.env.CLOUD_SCHEDULER_JOB_NAME || 'schedule-runner';

let schedulerClient = null;

function getClient() {
  if (!schedulerClient) {
    schedulerClient = new CloudSchedulerClient();
    logInfo('schedulerControl', 'client.created', {
      schedulerLocation,
      schedulerJobName,
    });
  }
  return schedulerClient;
}

async function getJobPath() {
  const envProjectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.PROJECT_ID ||
    '';
  const projectId = envProjectId || await getClient().getProjectId();
  if (!projectId) {
    throw new Error('Unable to resolve GCP project ID for Cloud Scheduler.');
  }
  return getClient().jobPath(projectId, schedulerLocation, schedulerJobName);
}

export async function getSchedulerConfig() {
  const client = getClient();
  const jobPath = await getJobPath();
  const [job] = await client.getJob({ name: jobPath });
  logInfo('schedulerControl', 'config.get.success', {
    jobPath,
    schedule: job.schedule || '',
    timeZone: job.timeZone || 'Europe/Paris',
  });

  return {
    jobName: schedulerJobName,
    location: schedulerLocation,
    schedule: job.schedule || '',
    timeZone: job.timeZone || 'Europe/Paris',
    uri: job.httpTarget?.uri || '',
    state: job.state || 'STATE_UNSPECIFIED',
  };
}

export async function updateSchedulerConfig(input) {
  const schedule = String(input?.schedule || '').trim();
  const timeZone = String(input?.timeZone || '').trim();

  if (!schedule) {
    throw new Error('schedule is required');
  }

  const client = getClient();
  const jobPath = await getJobPath();
  const [existing] = await client.getJob({ name: jobPath });
  const updatedJob = {
    ...existing,
    schedule,
    timeZone: timeZone || existing.timeZone || 'Europe/Paris',
  };

  let job;
  try {
    [job] = await client.updateJob({
      job: updatedJob,
      updateMask: {
        paths: ['schedule', 'time_zone'],
      },
    });
  } catch (error) {
    logError('schedulerControl', 'config.update.error', { jobPath, schedule, timeZone, error });
    throw error;
  }

  logInfo('schedulerControl', 'config.update.success', {
    jobPath,
    schedule: job.schedule || '',
    timeZone: job.timeZone || 'Europe/Paris',
  });

  return {
    jobName: schedulerJobName,
    location: schedulerLocation,
    schedule: job.schedule || '',
    timeZone: job.timeZone || 'Europe/Paris',
    uri: job.httpTarget?.uri || '',
    state: job.state || 'STATE_UNSPECIFIED',
  };
}
