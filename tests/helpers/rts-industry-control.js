var IndustryControl = new IndustryControlClass();
function IndustryControlClass() {
	this.jSon = new IndustryControlJSon();
	this.hidden = null;
	this.content = null;
	this.id = '';
	this.path = '';
	this.entityType = '';

	this.init = function(id, path, entitytype, url) {
		this.id = id;
		this.path = path;
		this.entityType = entitytype;
		this.content = document.getElementById(id + 'Content');
		this.hidden = document.getElementById(id + 'Hidden');
		this.loadFromTemplate();
		this.loadJSon(url);
	};

	this.loadJSon = function(url) {
		var control = this;
        $('#processingSpinner').show();
		if (control.entityType == "fund") {
			control.id = document.getElementById('fundId').value;
		}
		$.ajax({
			type : "GET",
			url : url,
			dataType : "json",
			data : {
				id : control.id,
				type : control.entityType
			},
			
			success : function (req) {
                if (req) {
                    control.jSon = req;
                    control.restore();
                }
                control.content.style.display = 'block';
                $('#processingSpinner').hide();
			},
			error : function () {
				alert("error");
			}
		});
	};

	this.loadFromTemplate = function() {
		this.content.innerHTML = IndustryControlTemplate.html.replace(/tmp_id/g, this.id).replace(/tmp_path/g, this.path);
		this.content.style.display = 'none';

		this.jSon.items = [];
		for (var i = 0; i < IndustryControlTemplate.jSon.items.length; i ++) {
			var group = IndustryControlTemplate.jSon.items[i];
			var copyGroup = new groupBean();
			copyGroup.id = group.id;
			copyGroup.code = group.code;
			copyGroup.description = group.description;
			copyGroup.checked = 0;
			copyGroup.items = [];
			for (var j = 0; j < group.items.length; j ++) {
				var segment = group.items[j];
				var copySegment = new segmentBean();
				copySegment.id = segment.id;
				copySegment.code = segment.code;
				copySegment.description = segment.description;
				copySegment.parentId = group.id;
				copySegment.checked = 0;
				copySegment.items = [];
				for (var k = 0; k < segment.items.length; k ++) {
					var code = segment.items[k];
					var copyCode = new codeBean();
					copyCode.id = code.id;
					copyCode.code = code.code;
					copyCode.description = code.description;
					copyCode.parentId = segment.id;
					copySegment.checked = 0;
					copySegment.items.push(copyCode);
				}
				copyGroup.items.push(copySegment);
			}
			this.jSon.items.push(copyGroup);
		}
	};

	this.restore = function() {
		for (var i = 0; i < this.jSon.items.length; i ++) {
			var group = this.jSon.items[i];
			var segmenCount = 0;
			this.setGroup(group, group.checked);
			for (var j = 0; j < group.items.length; j ++) {
				var segment = group.items[j];
				var codeCount = 0;
				if (segment.checked == 1) {
					segmenCount++;
				} 
				this.setSegment(segment, segment.checked);
				for (var k = 0; k < segment.items.length; k ++) {
					var code = segment.items[k];
					if (code.checked == 1) {
						codeCount++;
					} 
					this.setCode(code, code.checked);
				}
				if (codeCount > 0) {
					var expander = document.getElementById('industryControlSegment' + segment.id + this.id + 'Expander');
					IndustryControlTemplate.expand(expander, 'industryControlSegment' + segment.id + this.id + 'Child');
				}
			}
			if (segmenCount > 0) {
				var expander = document.getElementById('industryControlGroup' + group.id + this.id + 'Expander');
				IndustryControlTemplate.expand(expander, 'industryControlGroup' + group.id + this.id + 'Child');
			}
		}
		this.setHidden();
	};

	this.checkGroup = function(checker, groupIndx) {
		var group = this.jSon.items[groupIndx];
		if (group.checked == 1 || group.checked == 2) {
			this.setGroup(group, 0);
		} else {
			this.setGroup(group, 1);
		}

		for (var i = 0; i < group.items.length; i++) {
			var segment = group.items[i];
			if (group.checked == 0) this.setSegment(segment, group.checked);
			for (var j = 0; j < segment.items.length; j++) {
				if (segment.checked == 0) {
					this.setCode(segment.items[j], segment.checked);
				}
			}
		}
		this.setHidden();
	};

	this.checkSegment = function(checker, groupIndx, segmentIndx) {
		var group = this.jSon.items[groupIndx];
		var segment = group.items[segmentIndx];
		if (segment.checked == 1 || segment.checked == 2) {
			this.setSegment(segment, 0);
		} else {
			this.setSegment(segment, 1);
		}

		for (var i = 0; i < segment.items.length; i++) {
			if (segment.checked == 0) {
				this.setCode(segment.items[i], segment.checked);
			}
		}

		for (var i = 0; i < group.items.length; i++) {
			if (group.items[i].checked == 1) {
				this.setGroup(group, 1);
				break;
			}
		}

		this.setHidden();
	};

	this.checkCode = function(checker, groupIndx, segmentIndx, codeIndx) {
		var group = this.jSon.items[groupIndx];
		var segment = group.items[segmentIndx];
		var code = segment.items[codeIndx];
		if (code.checked == 1) {
			this.setCode(code, 0);
		} else {
			this.setCode(code, 1);
		}

		for (var i = 0; i < segment.items.length; i++) {
			if (segment.items[i].checked == 1) {
				this.setSegment(segment, 1);
				break;
			} else if (this.entityType == 'company') {
				this.setSegment(segment, 0);
			}
		}
	
		for (var i = 0; i < group.items.length; i++) {
			if (group.items[i].checked == 1) {
				this.setGroup(group, 1);
				break;
			} else if (this.entityType == 'company') {
				this.setGroup(group, 0);
			}
		}

		this.setHidden();
	};

	this.setGroup = function(group, flag) {
		var groupChecker = document.getElementById('industryControlGroup' + group.id + this.id + 'CheckBox');
		switch (flag) {
			case 0 : {
				groupChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox';
				break;
			}
			case 1 : {
				groupChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox_checked';
				break;
			}
			default : {
				flag = 0;
				groupChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox';
			}
		}
		group.checked = flag;
	};

	this.setSegment = function(segment, flag) {
		var segmentChecker = document.getElementById('industryControlSegment' + segment.id + this.id + 'CheckBox');
		switch (flag) {
			case 0 : {
				segmentChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox';
				break;
			}
			case 1 : {
				segmentChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox_checked';
				break;
			}
			default : {
				flag = 0;
				segmentChecker.className = (this.entityType == "company")? 'controls_emptyCheckBox' : 'controls_checkBox';
			}
		}
		segment.checked = flag;
	};

	this.setCode = function(code, flag) {
		var codeChecker = document.getElementById('industryControlCode' + code.id + this.id + 'CheckBox');
		switch (flag) {
			case 0 : {
				codeChecker.className = 'controls_checkBox';
				break;
			}
			case 1 : {
				codeChecker.className = 'controls_checkBox_checked';
				break;
			}
			default : {
				flag = 0;
				codeChecker.className = 'controls_checkBox';
			}
		}
		code.checked = flag;
	};

	this.setHidden = function() {
		this.hidden.value = JSON.stringify(this.jSon);
		if (this.hidden.onchange) {
			this.hidden.onchange();
		}
	}
}

function groupBean() {
	this.id = '';
	this.code = '';
	this.description = '';
	this.checked = 0;
	this.items = [];
}

function segmentBean() {
	this.id = '';
	this.parentId = '';
	this.code = '';
	this.description = '';
	this.checked = 0;
	this.items = [];
}

function codeBean() {
	this.id = '';
	this.parentId = '';
	this.code = '';
	this.description = '';
	this.checked = 0;
}

function IndustryControlJSon() {
	this.items = [];
}

function onLoad(betype, url) {
	IndustryControlTemplate.load(betype);
	var id = document.getElementById('id').value;
	IndustryControl.init(id, 'IndustryControl', betype, url);
    registerOnSaveTrigger(function() {
        var $button = $("#saveIndustryButton");
        if (!$button.prop("disabled")) {
            $button.click();
        }
    });
}

async function submitIndustryControl(form) {
    var jqueryForm = $(form);
    var countCheckedIndustryGroups = jqueryForm.find(".controls_checkBox_checked").length;

    if (IndustryControl.entityType == 'company' && countCheckedIndustryGroups == 0
        && !isEmptyIndustryGroupForCompanyAllowed($(window.opener.document.forms['companyGeneralInfoForm']))
		&& (form.action.indexOf("/industryGroup/save.html") > 0)) {
        alert("Please select an Industry Group");
    } else {
        $('.processingSpinner').show();
		var $button = $("#saveIndustryButton");
		disableButton($button, "buttonSave");

        const {message} = await checkNeedConfirmIndustryGroupSave(jqueryForm);
        if (message && !confirm(message)) {
            $('.processingSpinner').hide();
            enableButton($button, "buttonSave");
            return;
        }

        $.ajax({
            type : "POST",
            url : form.action,
            data : jqueryForm.serialize(),
            success : function (req) {
				var json = JSON.parse(req);
				if (json.status == 'error') {
					alert(json.message);
					$('.processingSpinner').hide();
					enableButton($button, "buttonSave");
				} else {
					if (IndustryControl.entityType == 'fund') {
						var $checkbox = $('#doNotAllowUpdateIndustryGroupCheckbox', opener.document);
						if (!$checkbox.is(':checked')) {
							$checkbox.click();
						}
					}
					setTimeout("closeIndustryCodes();", 500);
				}
            },
            error : function() {
                document.getElementById('mainSection').innerHTML = document.getElementById('errorLabel').innerHTML;
            }
        });
    }
}

function closeIndustryCodes() {
	if (null != $(opener.document).find("#primaryIndustryId").val()) {
        $(opener.document).find("#primaryIndustryId").val("0");
	}
	var surveyType = opener.document.getElementById('submissionType');
	if (surveyType && surveyType.value == '1') {
		opener.submitSurveyCompanyGeneralInfoForm(opener.document.forms['surveyCompanyGeneralInfoForm']);
	}
	if (surveyType && surveyType.value == '2') {
		if (document.getElementById("type").value == "investor") {
			opener.submitSurveyInvestorGeneralInfoForm(opener.document.forms['surveyInvestorGeneralInfoForm']);
		} else {
			var id = document.getElementById("fundId").value;
			if (document.getElementById("type").value == "fund") {
				opener.submitFundPreferences(opener.document.forms['surveyFundDetailsPreferencesForm']);
			}
			if (document.getElementById("type").value == "upcomingFund") {
				opener.submitUpcomingInformationIndustry(opener.document.forms['surveyFundUpcomingInformationForm']);
			}
		}
	}
	window.close();
}

function checkNeedConfirmIndustryGroupSave(jqueryForm) {
    return new Promise((resolve) => {
        const noConfirmResult = {message: null};

        $.ajax({
            type: "POST",
            url: "/industryGroup/validateOnSave",
            data: jqueryForm.serialize(),
            success: function (response) {
                const json = JSON.parse(response);
                resolve(json.status === 'error' ? {message: json.message} : noConfirmResult);
            },
            error: function (response) {
                const json = JSON.parse(response.responseText);
                if (json.message) {
                    alert(json.message);
                } else {
                    console.error(json);
                }
                resolve(noConfirmResult);
            }
        });
    });
}
