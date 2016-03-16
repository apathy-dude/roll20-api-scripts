/**
 * Provides a dice rolling command specialized for MLP: RiM season 4 edition.
 * The syntax for the command is
 * !r {skill name} [+/- Advantages/Drawbacks] ["Any notes about the skill roll"]
 *
 * e.g.
 * !r Mathematics +1 "+2 if used as part of a spell"
 *
 * The skill name is case-insensitive and supports shortened names. For example
 * instead of rolling "!r spellcasting", you can roll "!r spell".
 *
 * In order to roll a skill check for a character, you must be currently
 * speaking as that character.
 *
 * There are a couple other assumptions the script makes about a character's
 * attributes in order for it to work:
 * - All attributes related to skills have the word 'skill' in them somewhere.
 * - Skill attributes are divided into 4 parts:
 *      repeating_skills{mind|body|heart}_{repeating skills index}_{SkillAttributeName}
 *
 *      * The 1st part is just a literal used by roll20 for all repeating fieldset attributes
 *      on a character sheet.
 *      * The 2nd part is the name of the repeating field set. The script assumes that
 *      your character sheets have skillsmind, skillsbody, and skillsheart repeating
 *      fieldsets, which are identical accept for the primary attribute they're
 *      based off of.
 *      * The 3rd part is the index of the skill's group of attributes in the
 *      repeating fieldset. All attributes for one skill share this index. It too
 *      is automatically generated by Roll20's character sheet API.
 *      * The 4th part is the name of an attribute for the skill. This script assumes
 *      that each skill's repeating field set contains fields with these names:
 *      skillX, skillXT, skillXI, skillXG, skillXMisc, skillXConds where X is M, B, or H for
 *      mind, body, and heart respectively.
 *
 *      skillX is the text field actually containing the skill's name.
 *
 *      skillXT is a checkbox field marking whether the skill is trained. I.E.
 *      The character took the Skill Training edge for that skill.
 *      The checkbox's value when checked is 1.
 *
 *      skillXI is a checkbox for Improved Skill Training for the skill, again
 *      with a checked value of 1.
 *
 *      skillXG is a checkbox for Greater Skill Training for the skill, again
 *      with a checked value of 1.
 *
 *      skillXMisc is a number field for the total of any other modifiers for
 *      the skill, which aren't Advantages and Drawbacks.
 *
 *      skillXConds is a text field where players can write any notes about
 *      the skill, such as for conditional modifiers. Nothing here is parsed
 *      for the dice rolling math.
 */
(function() {

    var cmd = "!r ";

    /**
     * Gets the character the player is currently speaking as.
     * @param {String} playerId     The player's ID.
     * @return {Character}
     */
    function getCharacter(playerId) {
        var player = findObjs({
          _type: 'player',
          _id: playerId
        })[0];

        log(player);

        var speakingAs = player.get('speakingas') || player.get('_displayname');
        if(speakingAs.indexOf('player') === 0)
            throw new Error('You are not currently speaking as a character.');
        else if(speakingAs.indexOf('character') === 0) {
            var characterId = speakingAs.replace('character|', '');
            log(speakingAs, characterId);
            return findObjs({
              _type: 'character',
              _id: characterId
            })[0];
        }
        else {
            var character = findObjs({
                _type: 'character',
                name: speakingAs
            })[0];
            if(character)
                return character;
            else
                throw new Error('Bad speakingas value: ' + speakingAs);
        }
    };

    /**
     * Gets all the skill attributes for a character.
     * @param {Character} character
     * @return {Attribute[]}
     */
    function getAllSkills(character) {
        return _.filter(findObjs({
                _type: "attribute",
                _characterid: character.id
            }), function(attr) {
                return (attr.get("name").indexOf("skill") !== -1);
            });
    };



    /**
     * Gets information about a skill.
     * @param {Character} character
     * @param {String} name     The name of the skill.
     * @return {Object}
     */
    function getSkill(character, name) {
        var skills = getAllSkills(character);
        var skill = _.find(skills, function(attr) {
            var value = getSkillName(attr);
            return (value.indexOf(name) !== -1);
        });

        if(skill) {
            var name = getSkillName(skill);
            var toks = splitSkill(skill);
            var index = toks[0];
            var type = toks[1];

            var trained = (parseInt(getSkillField(skills, type, index, "T")) == 1);
            var improved = (parseInt(getSkillField(skills, type, index, "I")) == 1);
            var greater = (parseInt(getSkillField(skills, type, index, "G")) == 1);
            var bonus = parseInt(getSkillField(skills, type, index, "Misc")) || 0;
            var notes = getSkillField(skills, type, index, 'Conds') || '';

            var adv = parseInt(getSkillField(skills, type, index, 'Adv')) || 0;
            var dis = parseInt(getSkillField(skills, type, index, 'Dis')) || 0;
            var advDis = adv - dis;

            var attr = {};
            if(type === "skillM")
                attr.name = "mind";
            if(type === "skillB")
                attr.name = "body";
            if(type === "skillH")
                attr.name = "heart";

            attr.value = getAttrByName(character.id, attr.name);

            return {
                name: name,
                attr: attr,
                trained: trained,
                improved: improved,
                greater: greater,
                advDis: advDis,
                bonus: bonus,
                notes: notes
            };
        }
    };

    /**
     * [splitSkill description]
     * @param  {[type]} skill
     * @return {[type]}
     */
    function splitSkill(skill) {
        var toks = skill.get("name").split("_");
        return [toks[2], toks[3]];
    };

    /**
     * Gets the value of the attribute for a skill's name.
     */
    function getSkillName(skill) {
        return skill.get("current").toLowerCase();
    };

    /**
     * Extracts a field value for a skill.
     */
    function getSkillField(skills, type, index, field) {
        var field = _.find(skills, function(skill) {
            var toks = splitSkill(skill);
            return (toks[0] === index && toks[1] === (type + field));
        });
        if(field)
            return field.get("current");
        else
            return undefined;
    };


    /**
     * Parses the Advantage/Disadvantage total from an expression of
     * of +N advantages and -N disadvantages. E.g. "+2 -1 + 4"
     * @return {Boolean}
     */
    function parseAdvDis(expr) {
      if(!expr)
        return 0;

      expr = expr.replace(' ', '');
      var total = 0;
      var regex = /([+]|-)(\d+)/g

      // Get the first match.
      var match = regex.exec(expr);
      while(match) {
        if(match[1] === '+')
          total += parseInt(match[2]);
        else
          total -= parseInt(match[2]);

        // Get the next match.
        match = regex.exec(expr);
      }

      return total;
    }

    /**
     * An object representing a skillcheck.
     * @typedef {object} SkillCheck
     * @property {string} skillName   The name of the skill, or what its name starts with.
     * @property {int} advDis   The total Advantage/Disadvantage modifier.
     * @property {string} note  A string appended to the roll's notes.
     */

     /**
      * An object representing a skill and its attributes.
      * @typedef {object} Skill
      * @property {string} name
      * @property {SkillAttr} attr
      * @property {boolean} trained
      * @property {boolean} improved
      * @property {boolean} greater
      * @property {int} advDis
      * @property {int} bonus
      * @property {string} notes
      */

     /**
      * The attribute used for a skillcheck.
      * @typedef {object} SkillAttr
      * @property {string} name
      * @property {int} value
      */

    /**
     * Rolls a skill check for a character using the skillcheck template.
     * @param {Character} character
     * @param  {SkillCheck} skillCheck
     */
    function rollSkillCheck(character, skillCheck) {
      var charName = character.get('name');

      var skill = getSkill(character, skillCheck.skillName);

      var notes = skill.notes;
      if(skillCheck.note) {
        if(skill.notes)
          notes += '<br>'
        notes += skillCheck.note;
      }
      var advDis = skill.advDis + skillCheck.advDis;
      if(advDis >= 0)
        advDis = '+' + advDis;

      var training = 'untrained';
      var dice = '2d6';
      if(skill.greater) {
        training = 'greater';
        dice = '4d6d2';
      }
      else if(skill.improved) {
        training = 'improved';
        dice = '4d6d2';
      }
      else if(skill.trained) {
        training = 'trained';
        dice = '3d6d1';
      }

      var roll = '{{ ' + dice + ' ' + advDis + ', 12 + 1d0}kl1, 2 + 1d0}kh1 ';
      if(skill.greater) {
        roll += '+1 [G] ';
      }
      roll += ' +' + skill.attr.value + '[' + skill.attr.name + '] + ' + skill.bonus;

      var templateStr = '&{template:skillcheck} {{charName=' + charName + '}} ';
      templateStr += '{{skillName=' + skillCheck.skillName + '}} {{result=[[' + roll + ']]}} ';
      templateStr += '{{' + training + '=true}} ';
      if(notes) {
        templateStr += '{{notes=' + notes + '}}';
      }

      sendChat(character.get('name'), templateStr);
    }

    on("chat:message", function(msg) {
        try {
            if(msg.type == "api" && msg.content.indexOf(cmd) !== -1) {
                var playerId = msg.playerid;
                var character = getCharacter(playerId);
                var str = msg.content.replace(cmd, "");

                // Process the roll command as a regular expression.
                //
                // group 1 is the skill name.
                // group 2 is the advantage/disadvantage modifier.
                // group 6 is a string appended to the notes for the roll.
                var regex = /([^+\-\\"]+)(( *([+]|-) *\d+)*)? *("(.*?)")?/;
                var match = regex.exec(str);

                var skillName = match[1].trim().toLowerCase();
                var advDis = parseAdvDis(match[2]);
                var note = match[6];

                if(match) {
                    var skillCheck = {
                        skillName: skillName,
                        advDis: advDis,
                        note: note
                    };
                    rollSkillCheck(character, skillCheck);
                }
                else
                    throw new Error('Bad roll format. Expected format: {skill name} [+/- Advantage/Disadvantage modifier] ["any notes about the roll"]');
            }
        }
        catch(err) {
            sendChat("ERROR", "/w " + msg.who + " Error processing roll: " + msg.content);
            log('MLP Dice ERROR: ' + err.message);
        }

    });
})();