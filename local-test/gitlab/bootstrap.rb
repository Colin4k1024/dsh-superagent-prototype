# Create the local GitLab test users, tokens and project. Run inside the container with gitlab-rails runner.
require 'json'

def ensure_user(username, name, email, password)
  user = User.find_by_username(username)
  return user if user
  user = User.new(username: username, name: name, email: email, password: password, password_confirmation: password)
  user.skip_confirmation!
  user.save!
  user
end

def issue_token(user, name)
  user.personal_access_tokens.where(name: name).destroy_all
  token = user.personal_access_tokens.create!(name: name, scopes: ['api', 'write_repository'], expires_at: 30.days.from_now)
  token.token
end

root = User.find_by_username('root') or raise 'root user missing'
agent = ensure_user('dsh-agent', 'DSH Agent', 'dsh-agent@example.com', 'AgentPass123!')
reviewer = ensure_user('dsh-reviewer', 'DSH Reviewer', 'dsh-reviewer@example.com', 'ReviewerPass123!')
merger = ensure_user('dsh-merger', 'DSH Merger', 'dsh-merger@example.com', 'MergerPass123!')

group = Group.find_by_path('dsh-test') || Group.create!(name: 'DSH Test', path: 'dsh-test', visibility_level: 0)
project = Project.find_by_full_path('dsh-test/widgets')
unless project
  project = Project.create!(name: 'widgets', path: 'widgets', namespace: group, creator: root, visibility_level: 0)
end
{ agent => 30, reviewer => 40, merger => 40 }.each do |user, level|
  member = ProjectMember.find_by(project: project, user: user)
  member ? member.update!(access_level: level) : ProjectMember.create!(project: project, user: user, access_level: level)
end

puts JSON.generate({ project_id: project.id, project: project.full_path,
  root: issue_token(root, 'dsh-root'), agent: issue_token(agent, 'dsh-agent'),
  reviewer: issue_token(reviewer, 'dsh-reviewer'), merger: issue_token(merger, 'dsh-merger') })
