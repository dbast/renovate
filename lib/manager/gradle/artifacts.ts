import fs from 'fs';
import upath from 'upath';
import { GlobalConfig } from '../../config/global';
import { TEMPORARY_ERROR } from '../../constants/error-messages';
import { logger } from '../../logger';
import { exec } from '../../util/exec';
import type { ExecOptions } from '../../util/exec/types';
import { readLocalFile, stat } from '../../util/fs';
import { getRepoStatus } from '../../util/git';
import { addIfUpdated } from '../gradle-wrapper/artifacts';
import {
  extraEnv,
  getJavaContraint,
  getJavaVersioning,
  gradleWrapperFileName,
  prepareGradleCommand,
} from '../gradle-wrapper/utils';
import type { UpdateArtifact, UpdateArtifactsResult } from '../types';

async function getHashMethods(metaDataFile: string): Promise<string[]> {
  const verificationData = await readLocalFile(metaDataFile);
  const hashMethods = ['sha512', 'sha256', 'sha1', 'md5'].filter((method) =>
    verificationData.includes(method)
  );
  return hashMethods;
}

export async function updateArtifacts({
  packageFileName,
  newPackageFileContent,
  updatedDeps,
  config,
}: UpdateArtifact): Promise<UpdateArtifactsResult[] | null> {
  try {
    const projectDir = GlobalConfig.get('localDir');
    const metaDataFile = upath.join(
      projectDir,
      'gradle',
      'verification-metadata.xml'
    );

    if (!fs.existsSync(metaDataFile)) {
      logger.info(`No verification metadata file present: "${metaDataFile}"`);
      return null;
    }
    logger.debug(`Found verification metadata file: "${metaDataFile}"`);

    const hashMethods = await getHashMethods(metaDataFile);
    logger.debug(`Found hash types: "${hashMethods.toString()}"`);

    if (hashMethods.length === 0) {
      logger.info('No supported checksum type found');
      return null;
    }

    const gradlew = gradleWrapperFileName();
    const gradlewPath = upath.resolve(projectDir, `./${gradlew}`);
    let cmd = await prepareGradleCommand(
      gradlew,
      projectDir,
      await stat(gradlewPath).catch(() => null),
      `wrapper`
    );
    if (!cmd) {
      logger.info('No gradlew found - skipping Artifacts update');
      return null;
    }

    cmd += ` --write-verification-metadata "${hashMethods.toString()}" help`;
    logger.debug(`Updating verification metadata: "${cmd}"`);
    const execOptions: ExecOptions = {
      docker: {
        image: 'java',
        tagConstraint:
          config.constraints?.java ?? getJavaContraint(config.currentValue),
        tagScheme: getJavaVersioning(),
      },
      extraEnv,
    };
    try {
      await exec(cmd, execOptions);
    } catch (err) {
      // istanbul ignore if
      if (err.message === TEMPORARY_ERROR) {
        throw err;
      }
      logger.warn(
        { err },
        'Error executing gradle wrapper update command. It can be not a critical one though.'
      );
    }

    const status = await getRepoStatus();
    const updateArtifactsResult = (
      await Promise.all([addIfUpdated(status, metaDataFile)])
    ).filter(Boolean);
    logger.debug(
      { files: updateArtifactsResult.map((r) => r.file.path) },
      `Returning updated verification metadata file`
    );
    return updateArtifactsResult;
  } catch (err) {
    logger.debug({ err }, 'Error setting updating verification metadata file');
    return [
      {
        artifactError: {
          lockFile: packageFileName,
          stderr: err.message,
        },
      },
    ];
  }
}
