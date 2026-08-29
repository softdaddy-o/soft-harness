const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

async function askLine(question, options) {
    if (options && typeof options.askLine === 'function') {
        return options.askLine(question);
    }

    const rl = readline.createInterface({
        input: (options && options.input) || stdin,
        output: (options && options.output) || stdout
    });

    try {
        const answer = await rl.question(question);
        return answer.trim();
    } finally {
        rl.close();
    }
}

async function confirm(question, options) {
    if (options && typeof options.confirm === 'function') {
        return options.confirm(question);
    }

    const answer = (await askLine(`${question} [y/N] `, options)).toLowerCase();
    return answer === 'y' || answer === 'yes';
}

async function select(question, choices, options) {
    if (options && typeof options.select === 'function') {
        return options.select(question, choices);
    }

    const lines = [question];
    for (let index = 0; index < choices.length; index += 1) {
        lines.push(`  ${index + 1}. ${choices[index].label}`);
    }

    const raw = await askLine(`${lines.join('\n')}\n> `, options);
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
        return choices[numeric - 1].value;
    }

    const direct = choices.find((choice) => choice.value === raw);
    if (!direct) {
        throw new Error(`invalid selection: ${raw}`);
    }

    return direct.value;
}

async function classifyAmbiguous(relativePath, matches, options) {
    if (matches.length === 1) {
        return matches[0];
    }
    return select(
        `Classify ${relativePath}:`,
        matches.map((match) => ({
            label: match,
            value: match
        })),
        options
    );
}

module.exports = {
    askLine,
    classifyAmbiguous,
    confirm,
    select
};
