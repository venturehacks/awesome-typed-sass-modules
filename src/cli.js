#!/usr/bin/env node

import DtsCreator from 'typed-css-modules';
import chalk from 'chalk';
import chokidar from 'chokidar';
import cosmiconfig from 'cosmiconfig';
import fs from 'fs';
import glob from 'glob';
import path from 'path';
import sass from 'node-sass';
import tildeImporter from 'node-sass-tilde-importer';
import yargs from 'yargs';

const pkg = require('../package.json');

const sassConfig = (() => {
    const rc = cosmiconfig('sass').searchSync();
    return rc === null ? {} : rc.config;
})();

const readSass = (pathName, relativeTo) => (
    new Promise((resolve, reject) => {
        sass.render(
            Object.assign({}, sassConfig, { file: pathName, importer: tildeImporter }),
            (err, result) => {
                if (err && (relativeTo && relativeTo !== '/')) {
                    return resolve([]);
                } else if (err && (!relativeTo || relativeTo === '/')) {
                    return reject(err);
                }
                return resolve(result.css.toString());
            },
        );
    })
);

const createTypings = (pathName, creator, cache, handleError, handleWarning, verbose) => (
    readSass(pathName)
        .then(content => creator.create(pathName, content, cache))
        .then(c => c.writeFile())
        .then((c) => {
            if (verbose) {
                console.info(`Created ${chalk.green(c.outputFilePath)}`);
            }

            if (c.messageList) {
                c.messageList.forEach((message) => {
                    const warningTitle = chalk.yellow(`WARNING: ${pathName}`);
                    const warningInfo = message;
                    handleWarning(`${warningTitle}\n${warningInfo}`);
                });
            }

            return c;
        })
        .catch((reason) => {
            const errorTitle = chalk.red(`ERROR: ${pathName}`);
            const errorInfo = reason;
            handleError(`${errorTitle}\n${errorInfo}`);
        })
);

const createTypingsForFileOnWatch = (creator, cache, verbose) => (pathName) => {
    let warnings = 0;
    let errors = 0;

    const handleError = (error) => {
        console.error(error);
        errors += 1;
    };
    const handleWarning = (warning) => {
        console.warn(warning);
        warnings += 1;
    };
    const onComplete = () => {
        if (warnings + errors > 0) {
            console.info(`${pathName}: ${warnings} warnings, ${errors} errors`);
        }
        warnings = 0;
        errors = 0;
    };

    return createTypings(pathName, creator, cache, handleError, handleWarning, verbose)
        .then(onComplete);
};

const createTypingsForFiles = (creator, cache, verbose) => (pathNames) => {
    let warnings = 0;
    let errors = 0;

    const handleError = (error) => {
        console.error(error);
        errors += 1;
    };
    const handleWarning = (warning) => {
        console.warn(warning);
        warnings += 1;
    };
    const onComplete = () => {
        if (warnings + errors > 0) {
            console.info(`Completed with ${warnings} warnings and ${errors} errors.`);
        }
        errors = 0;
        warnings = 0;
    };

    return Promise.all(pathNames.map(
        pathName => createTypings(pathName, creator, cache, handleError, handleWarning, verbose),
    )).then(onComplete);
};


const main = () => {
    const yarg = yargs
        .usage('$0 [inputDir] [options]', 'Create .scss.d.ts from CSS modules *.scss files.', (commandYargs) => {
            commandYargs
                .positional('inputDir', {
                    describe: 'Directory to search for scss files.',
                    type: 'string',
                    default: '.',
                })
                .example('$0 src/styles')
                .example('$0 src -o dist')
                .example('$0 -p styles/**/*.scss -w');
        })

        .detectLocale(false)
        .version(pkg.version)

        .option('c', {
            alias: 'camelCase',
            default: false,
            type: 'boolean',
            describe: 'Convert CSS class tokens to camelCase',
        })
        .option('o', {
            alias: 'outDir',
            describe: 'Output directory',
        })
        .option('p', {
            alias: 'pattern',
            default: '**/[^_]*.scss',
            describe: 'Glob pattern with scss files',
        })
        .option('w', {
            alias: 'watch',
            default: false,
            type: 'boolean',
            describe: 'Watch input directory\'s scss files or pattern',
        })
        .option('d', {
            alias: 'dropExtension',
            default: false,
            type: 'boolean',
            describe: 'Drop the input files extension',
        })
        .option('v', {
            alias: 'verbose',
            default: false,
            type: 'boolean',
            describe: 'Show verbose message',
        })
        .option('i', {
            alias: 'ignore',
            describe: 'Glob pattern for files that should be ignored',
        })

        .alias('h', 'help')
        .help('h');

    const { argv } = yarg;

    // Show help
    if (argv.h) {
        yarg.showHelp();
        return;
    }

    const searchDir = argv.inputDir;
    // Show help if no search diretory present
    if (searchDir === undefined) {
        yarg.showHelp();
        return;
    }

    // If search directory doesn't exits, exit
    if (!fs.existsSync(searchDir)) {
        console.error(chalk.red(`Error: Input directory ${searchDir} doesn't exist.`));
        return;
    }

    // use foward slash. e.g. chokidar only supports glob with forward slashes
    const filesPattern = path.join(searchDir, argv.p).trim().replace(/\\/g, '/');

    const rootDir = process.cwd();

    const creator = new DtsCreator({
        rootDir,
        searchDir,
        outDir: argv.o,
        camelCase: argv.c,
        dropExtension: argv.d,
    });

    const cache = !!argv.w;

    if (!argv.w) {
        const globOptions = argv.i ? { ignore: argv.i } : null;
        glob(filesPattern, globOptions, (err, pathNames) => {
            if (err) {
                console.error(err);
                return;
            } else if (!pathNames || !pathNames.length) {
                console.info('Creating typings for 0 files');
                return;
            }
            console.info(`Creating typings for ${pathNames.length} files\n`);
            createTypingsForFiles(creator, cache, argv.v)(pathNames);
        });
    } else {
        console.info(`Watching ${filesPattern} ...\n`);

        const chokidarOptions = argv.i ? { ignored: argv.i } : null;
        const watcher = chokidar.watch(filesPattern, chokidarOptions);
        watcher.on('add', createTypingsForFileOnWatch(creator, cache, argv.v));
        watcher.on('change', createTypingsForFileOnWatch(creator, cache, argv.v));
    }
};

main();
